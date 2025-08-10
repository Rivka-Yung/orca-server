const express = require('express');
const router = express.Router();

const DetailsController = require('../controllers/sailDetailsController');

router.get('/:id', DetailsController.getSailById);

module.exports = router;


