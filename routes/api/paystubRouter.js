const express = require("express");
const router = express.Router();
const paystubController = require("../../controller/paystubController");

router.post("/presignedUrl", paystubController.getPresignedUrl);
router.post("/analyze", paystubController.analyzePaystub);
router.post("/upload", paystubController.uploadPDF)

module.exports = router;
