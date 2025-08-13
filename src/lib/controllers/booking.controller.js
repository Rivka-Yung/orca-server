const { checkAvailabilitySchema, addCustomerSchema } = require('../schemas/booking.schema.js');
const { ZodError } = require('zod');
const { findSailsWithOccupancy, getCustomerByPhoneNumber, addCustomer } = require('../storage/sql');

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

module.exports = {
    checkAvailability,
    checkExistingCustomer,
    addNewCustomer
};