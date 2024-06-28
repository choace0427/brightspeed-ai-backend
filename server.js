const express = require("express");
const cors = require("cors");
const session = require("express-session");
const uuidv4 = require("uuid").v4;
const bodyParser = require("body-parser");
const path = require("path");
const apiRouter = require("./routes/");
const compression = require('compression');


const morgan = require("morgan");
require("dotenv").config();

const app = express();

app.use(
  express.urlencoded({
    extended: false,
  })
);

app.use(compression({
    // Set the filter to a function that will handle only responses with the `Transfer-Encoding` header as `chunked`
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {
            // Don't compress responses with this request header
            return false;
        }
        // Only compress responses with the "chunked" transfer encoding
        return res.getHeader('Transfer-Encoding') === 'chunked';
    },
    threshold: 0, // Compress every response over this size (bytes). Set to 0 to compress all responses.
}));

app.use(morgan("tiny"));

// Register public directory
app.use("/static", express.static(path.join(__dirname, "public")));

//session
app.use(
  session({
    secret: uuidv4(),
    resave: false,
    saveUninitialized: true,
  })
);

app.use(express.json());

app.use(cors());

app.use(express.static(path.join(__dirname, "public")));

// Routes
app.use("/", apiRouter);
// app.use(errorHandler);

const port = process.env.PORT || 5000;

app.listen(port, "0.0.0.0", () =>
  console.log(`Server up and running on port ${port} !`)
);
