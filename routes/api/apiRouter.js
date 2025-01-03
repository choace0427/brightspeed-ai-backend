const express = require("express");
const router = express.Router();
const apiController = require("../../controller/apiController");

router.post("/analyze", apiController.analyzePDF);
router.post("/upload", apiController.uploadFiles);
router.delete('/delete', apiController.deleteAllUploads);
router.post('/id_card', apiController.iDCardFiles);

module.exports = router;
