// controllers/sailDetailsController.js
const sailsService = require('../storage/sql');

async function getSailById(req, res) {
    try {
        const sailId = parseInt(req.params.id);
        if (!sailId || isNaN(sailId)) {
            return res.status(400).json({ error: 'מזהה שיוט לא חוקי' });
        }

        const [sailData, bookingsData] = await Promise.all([
            sailsService.getSailById(sailId),
            sailsService.getBookingsBySailId(sailId)
        ]);

        if (!sailData) {
            return res.status(404).json({ error: 'שיוט לא נמצא' });
        }
        
        let totalPeopleActivity = 0;
        let totalPeopleJustSailing = 0;

        bookingsData.forEach(booking => {
            totalPeopleActivity += booking.num_people_activity || 0;
            totalPeopleJustSailing += booking.num_people_sail || 0;
        });

        const totalPeopleOnBoat = totalPeopleActivity + totalPeopleJustSailing;

        const requiresEscortResult = sailData.requires_orca_escort_2; 

        const capacityDetails = {
            max_capacity: sailData.boat_max_capacity || 0,
            currently_occupied: totalPeopleOnBoat,
            //חישוב המקומות הפנויים 
            available_places: Math.max(0, (sailData.boat_max_capacity || 0) - totalPeopleOnBoat - (requiresEscortResult ? 1 : 0))
        };
        
        const response = {
            sail_id: sailData.sail_id,
            date: sailData.date,
            planned_start_time: sailData.planned_start_time,
            actual_start_time: sailData.actual_start_time || null,
            end_time: sailData.end_time || null,
            population_type: sailData.population_type,
            is_private_group: sailData.is_private_group,
            boat_activity: sailData.boat_activity,
            requires_orca_escort_2: requiresEscortResult, 

            notes: sailData.notes,
            boat: sailData.boat,
            
            bookings: bookingsData.map(booking => ({
                booking_id: booking.booking_id,
                name: booking.name,
                phone: booking.phone,
                num_people_activity: booking.num_people_activity || 0,
                num_people_sail: booking.num_people_sail || 0,
                final_price: booking.final_price,
                payment_type: booking.payment_type,
                note: booking.note
            })),

            capacity_activity: totalPeopleActivity,
            capacity_sail: totalPeopleJustSailing,

            ...capacityDetails
        };
        
        res.status(200).json(response);
               
    } catch (error) {
        console.error(`Error in getSailById handler for sail ${req.params.id}:`, error);
        res.status(500).json({ error: 'שגיאה פנימית בשרת', details: error.message });
    }
}

module.exports = {
    getSailById
};