const express = require("express");
const router = express.Router();
const paystubRouter = require("./api/paystubRouter");


router.use(function (req, res, next) {
  res.header(
    "Access-Control-Allow-Headers",
    "x-access-token, Origin, Content-Type, Accept"
  );
  next();
});

router.use("/paystub", paystubRouter);

module.exports = router;
