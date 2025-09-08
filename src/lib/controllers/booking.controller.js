const { checkAvailabilitySchema, addCustomerSchema, addOrderSchema } = require('../schemas/booking.schema.js');
const { ZodError } = require('zod');
const { findSailsWithOccupancy, getCustomerByPhoneNumber, addCustomer, getPaymentTypeId, insertNewBooking, findSailByDetails, createNewSail } = require('../storage/sql');

//עזר
function isSailAvailable(sail, newBooking) {

    const activity_capacity = sail.activity_capacity ?? Infinity;

    const sail_capacity = sail.sail_capacity ?? Infinity;

    const free_places_activity = activity_capacity - sail.current_activity_occupancy;
    const free_places_sail = sail_capacity - sail.current_sail_occupancy;

    console.log(`Checking sail ${sail.sail_id}: 
        Activity: ${activity_capacity} (capacity) - ${sail.current_activity_occupancy} (occupancy) >= ${newBooking.num_people_activity} (needed) -> ${free_places_activity >= newBooking.num_people_activity}
        Sail: ${sail_capacity} (capacity) - ${sail.current_sail_occupancy} (occupancy) >= ${newBooking.num_people_sail} (needed) -> ${free_places_sail >= newBooking.num_people_sail}`);

    return free_places_activity >= newBooking.num_people_activity && free_places_sail >= newBooking.num_people_sail;
}

const checkAvailability = async (req, res, next) => {
    try {

        const searchParams = checkAvailabilitySchema.parse(req.body);

        // שלב 1: קבלת כל השיוטים הפוטנציאליים מהמסד נתונים
        const potentialSails = await findSailsWithOccupancy(searchParams);

        // שלב 2: סינון רק השיוטים שבאמת זמינים (שיש בהם מקום)
        const availableSails = potentialSails.filter(sail =>
            isSailAvailable(sail, searchParams)
        );

        // אם אין שום שיוט זמין אחרי סינון, תשובה ריקה
        if (availableSails.length === 0) {
            return res.status(200).json({ exactMatch: null, halfHourBefore: [], halfHourAfter: [] });
        }

        // שלב 3: חיפוש שיוטים שמתאימים בדיוק לשעה המבוקשת
        const exactMatchSail = availableSails.find(
            sail => sail.planned_start_time.slice(0, 5) === searchParams.time
        );

        if (exactMatchSail) {
            const response = {
                exactMatch: {
                    cruiseId: exactMatchSail.sail_id,
                    time: exactMatchSail.planned_start_time.slice(0, 5),
                    activityType: exactMatchSail.activity_name,
                    populationType: exactMatchSail.population_type_name,
                },
                halfHourBefore: [],
                halfHourAfter: [],
            };
            return res.status(200).json(response);
        }


        const beforeSails = availableSails
            .filter(sail => sail.planned_start_time.slice(0, 5) < searchParams.time)
            .map(sail => ({
                cruiseId: sail.sail_id,
                time: sail.planned_start_time.slice(0, 5),
                activityType: sail.activity_name,
                populationType: sail.population_type_name,
            }));

        const afterSails = availableSails
            .filter(sail => sail.planned_start_time.slice(0, 5) > searchParams.time)
            .map(sail => ({
                cruiseId: sail.sail_id,
                time: sail.planned_start_time.slice(0, 5),
                activityType: sail.activity_name,
                populationType: sail.population_type_name,
            }));

        const response = {
            exactMatch: null,
            halfHourBefore: beforeSails,
            halfHourAfter: afterSails,
        };

        res.status(200).json(response);

    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({ errors: error.errors.map(err => err.message) });
        }
        next(error);
    }
};

const checkExistingCustomer = async (req, res) => {
    const { phoneNumber } = req.query;

    if (!phoneNumber) {
        return res.status(400).json({ message: "The 'phoneNumber' query parameter is required." });
    }

    try {
        const customer = await getCustomerByPhoneNumber(phoneNumber);

        if (customer) {
            const response = {
                customer_id: customer.id.toString(),
                name: customer.name,
                phone_number: customer.phone_number,
                email: customer.email,
                whatsApp: customer.wants_whatsapp == 0 ? false : true,
                notes: customer.notes
            };

            res.status(200).json(response);
        } else {
            res.status(404).json({ message: `Customer with phone number ${phoneNumber} not found.` });
        }
    } catch (error) {
        console.error("Error in checkExistingCustomer:", error);
        res.status(500).json({ message: "Internal Server Error." });
    }
}



const addNewCustomer = async (req, res) => {
    try {

        const { body: validatedData } = addCustomerSchema.parse({
            body: req.body
        });


        const result = await addCustomer(validatedData);

        return res.status(201).json({
            message: 'Customer added successfully',
            customerId: result.insertId
        });

    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({
                message: 'Invalid input data',
                errors: error.flatten().fieldErrors
            });
        }

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                message: `A customer with the provided phone number already exists.`
            });
        }

        console.error('Error in addCustomer controller:', error);
        return res.status(500).json({
            message: 'An internal server error occurred.'
        });
    }
};

const addNewOrder = async (req, res) => {
    try {
       
        const { body: validatedData } = addOrderSchema.parse({
            body: req.body
        });


        const {
            customer,
            payment,
            num_people_activity, 
            num_people_sail,     
            is_phone_booking,   
            up_to_16_year    
        } = validatedData;


        let sailId;


        if ('cruiseId' in validatedData) {
            sailId = validatedData.cruiseId;
        } else {

            const { sailDate, plannedStartTime, populationTypeId, ...otherSailData } = validatedData;
            const existingSailId = await findSailByDetails({
                date: sailDate,
                startTime: plannedStartTime,
                populationTypeId: populationTypeId
            });

            if (existingSailId) {
                sailId = existingSailId;
            } else {
                const newSailData = {
                    date: sailDate,
                    plannedStartTime: plannedStartTime,
                    populationTypeId: populationTypeId,
                    ...otherSailData
                };
                const newSailResult = await createNewSail(newSailData);
                sailId = newSailResult.insertId;
            }
        }

        // // 3. בדיקת זמינות קריטית
        // const sailStatus = await getSailCapacityAndOccupancy(sailId);

        // if (!sailStatus) {
        //     return res.status(404).json({ message: "Sail not found. It may have been canceled." });
        // }

        // const requiredActivitySeats = participantsActivity || 0;
        // const requiredBoatSeats = participantsBoat || 0;
        // const availableActivitySeats = sailStatus.activity_capacity - sailStatus.current_activity_occupancy;
        // const availableBoatSeats = sailStatus.sail_capacity - sailStatus.current_sail_occupancy;

        // if (availableActivitySeats < requiredActivitySeats || availableBoatSeats < requiredBoatSeats) {
        //     return res.status(409).json({
        //         message: "Not enough space available on this sail.",
        //         details: {
        //             availableActivitySeats,
        //             requiredActivitySeats,
        //             availableBoatSeats,
        //             requiredBoatSeats
        //         }
        //     });
        // }

  
        let customerId;
        const existingCustomer = await getCustomerByPhoneNumber(customer.phone_number);
        if (existingCustomer) {
            customerId = existingCustomer.id;
        } else {
            const newCustomerResult = await addCustomer(customer);
            customerId = newCustomerResult.insertId;
        }

        // 5. בניית אובייקט ההזמנה עבור מסד הנתונים
        // --- כאן מבצעים את ה"תרגום" לשמות העמודות ב-DB ---


        const bookingToInsert = {
            sail_id: sailId,
            customer_id: customerId,
            num_people_sail: num_people_sail || 0,
            num_people_activity: num_people_activity || 0,
            final_price: payment.final_price,
            payment_type_id: payment.payment_type_id,
            is_phone_booking: is_phone_booking || false,
            notes: customer.notes || null, // חשוב: השתמש ב-null עבור DB
            up_to_16_year: up_to_16_year || false
        };
     
        const result = await insertNewBooking(bookingToInsert);

        return res.status(201).json({
            message: 'Order added successfully',
            orderId: result.insertId
        });

    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({
                message: 'Invalid input data',
                errors: error.flatten().fieldErrors
            });
        }

        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(404).json({
                message: 'Referenced entity not found (e.g., cruiseId or paymentTypeId is invalid).',
                errorDetails: error.sqlMessage
            });
        }

        console.error('Error in addNewOrder controller:', error);
        return res.status(500).json({ message: 'An internal server error occurred.' });
    }
};
module.exports = {
    checkAvailability,
    checkExistingCustomer,
    addNewCustomer,
    addNewOrder
};