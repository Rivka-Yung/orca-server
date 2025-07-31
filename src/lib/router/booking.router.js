const express = require('express');
const router = express.Router();

const bookingController = require('../controllers/booking.controller.js');


router.get('/', (req, res) => {
  res.send('booking API Router');
});

router.post('/check-availability', bookingController.checkAvailability);

router.get('/checkExistingCustomer', bookingController.checkExistingCustomer);


module.exports = router;