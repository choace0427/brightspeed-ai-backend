const express = require("express");
const router = express.Router();
const apiRouter = require("./api/apiRouter");


router.use(function (req, res, next) {
  res.header(
    "Access-Control-Allow-Headers",
    "x-access-token, Origin, Content-Type, Accept"
  );
  next();
});

router.use("/api", apiRouter);

module.exports = router;
