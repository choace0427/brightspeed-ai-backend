const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { DeleteObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { resError, resSuccess } = require("../utils/responseMessage");
const { s3Client } = require("../config/s3Client");
const AWS = require("../config/aws-config");
const multer = require('multer');
const path = require('path');
const hummus = require('hummus');
const {
  TextractClient,
  AnalyzeDocumentCommand,
} = require("@aws-sdk/client-textract");

// Initialize the Textract client
const textractClient = new TextractClient({
  region: "eu-west-2", // Specify your AWS region
});


const fs = require("fs");

require("dotenv").config();

const textract = new AWS.Textract();

const storage = multer.diskStorage({
  destination: './uploads/', // or any path where you want to save the file
  filename: function(req, file, cb){
    // Save the file with the current timestamp + original name
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});

// Init upload variable
const upload = multer({
  storage: storage,
  limits:{fileSize: 10000000}, // 10MB limit or whatever you prefer
  fileFilter: function(req, file, cb){
    checkFileType(file, cb);
  }
}).single('pdf');

function checkFileType(file, cb){
  // Allowed ext
  const filetypes = /pdf/;
  // Check ext
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  // Check mime
  const mimetype = filetypes.test(file.mimetype);

  if(mimetype && extname){
    return cb(null,true);
  } else {
    cb('Error: PDFs Only!');
  }
}



const getPresignedUrl = async (req, res) => {
  const data = req.body;
  const bucketParams = {
    Bucket: `ocr-demo-bucket-advantage`,
    Key: data.key,
    ContentType: "application/pdf",
  };

  console.log("----bucketParams----", bucketParams);

  try {
    const command = new PutObjectCommand(bucketParams);
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 36000,
    });
    console.log("-------signedUrl--------", signedUrl);
    const resData = {
      signedUrl: signedUrl,
      key: data.key,
    };
    res.send(resData);
  } catch (err) {
    console.log("Error creating presigned URL", err);
  }
};

// const analyzePaystub = async (req, res) => {
//   console.log("-----------", req.body);
//   const s3Url = new URL(req.body.url);
//   // const s3Url = new URL(
//   //   "https://pdf0storage.s3.amazonaws.com/paystub/Allen+-+Paystubs+Herc+08.25.2022-09.29.2022.pdf"
//   // );
//   const bucketName = s3Url.hostname.split(".")[0];
//   const keyName = s3Url.pathname.substring(1);
//   const startJobParams = {
//     DocumentLocation: {
//       S3Object: {
//         Bucket: bucketName,
//         // Name: "paystub/Allen - Paystubs Herc 08.25.2022-09.29.2022.pdf",
//         Name: keyName,
//       },
//     },
//   };
//
//   let ocrResult = [];
//
//   const startTextractJob = async () => {
//     return new Promise((resolve, reject) => {
//       textract.startDocumentTextDetection(startJobParams, (err, data) => {
//         if (err) {
//           reject(err);
//         } else {
//           resolve(data.JobId);
//         }
//       });
//     });
//   };
//
//   const getTextractJobStatus = async (jobId) => {
//     return new Promise((resolve, reject) => {
//       const checkJobStatus = setInterval(() => {
//         textract.getDocumentTextDetection({ JobId: jobId }, (err, data) => {
//           if (err) {
//             clearInterval(checkJobStatus);
//             reject(err);
//           } else if (data.JobStatus === "SUCCEEDED") {
//             clearInterval(checkJobStatus);
//             resolve(data);
//           } else if (data.JobStatus === "FAILED") {
//             clearInterval(checkJobStatus);
//             reject(new Error(`Textract job failed: ${data.StatusMessage}`));
//           }
//         });
//       }, 2000); // Check job status every 5 seconds
//     });
//   };
//
//   const getAllTextBlocks = async (jobId) => {
//     let nextToken = null;
//     let allBlocks = [];
//
//     do {
//       const response = await textract
//         .getDocumentTextDetection({
//           JobId: jobId,
//           NextToken: nextToken,
//         })
//         .promise();
//
//       if (response.Blocks) {
//         allBlocks = allBlocks.concat(response.Blocks);
//       }
//
//       nextToken = response.NextToken;
//     } while (nextToken);
//
//     return allBlocks;
//   };
//
//   try {
//     const jobId = await startTextractJob();
//     console.log("Textract job started. JobId:", jobId);
//
//     const textractResult = await getTextractJobStatus(jobId);
//     console.log("Textract job succeeded!");
//
//     const allBlocks = await getAllTextBlocks(jobId);
//
//     if (allBlocks.length > 0) {
//       ocrResult = allBlocks.map((block) => block.Text);
//       // Join ocrResult into a single string for easier searching
//       const ocrString = ocrResult.join(" ");
//       const keywords = [
//         "regular",
//         "adjustment",
//         "commission",
//         "holiday",
//         "net pay",
//         "paid time off",
//         "overtime",
//         "federal income tax",
//         "colorado",
//         "medicare",
//         "oasdi"
//     ];
//
//     const searchResults = {};
//
//     keywords.forEach((keyword) => {
//         const lowercaseKeyword = keyword.toLowerCase();
//         let lastCapturedIndex = -1; // Track the index of the last captured occurrence
//         searchResults[keyword] = [];
//
//         for (let i = 0; i < ocrResult.length; i++) {
//             const text = ocrResult[i]?.toLowerCase(); // Ensure the text exists and convert to lowercase
//             if (text === lowercaseKeyword && i > lastCapturedIndex + 5) {
//                 const context = ocrResult.slice(i, i + 7); // Capture 7 words around the keyword
//                 searchResults[keyword].push(context);
//                 lastCapturedIndex = i; // Update the last captured index
//             }
//         }
//
//         if (searchResults[keyword].length === 0) {
//             searchResults[keyword] = []; // Fill with empty strings if no occurrences found
//         }
//     });
//
//     console.log(searchResults);
//     res.send(searchResults);
//
//     } else {
//       console.log("No text blocks found in the document.");
//     }
//   } catch (error) {
//     console.error("Error processing Textract job:", error);
//     res.status(500).send("Error processing document.");
//     return;
//   }
// };

const chunkArray = (array, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
};


const analyzePaystub = async (req, res) => {
  try {
    console.log(req.body);
    if (req.body) {
      // ...existing code to process the OCR results...

      const s3KeysOfSplitPdfs = req.body; // Fill this array with the S3 keys of your split PDFs
      console.log(s3KeysOfSplitPdfs)
      // Prepare to store the Textract results for each page
      const textractResults = [];

      for (const s3Key of s3KeysOfSplitPdfs) {
        const analyzeDocumentRequestTemplate = {
          AdaptersConfig: {
            Adapters: [
              {
                AdapterId: "9abf280d752c", // Replace with your Adapter ID
                Pages: ["1"], // Specify the pages to apply the adapter
                Version: "2", // Replace with the adapter version
              },
            ],
          },
          Document: {
            S3Object: {
              Bucket: "ocr-demo-bucket-advantage",
              Name: s3Key, // Assuming s3Key is defined elsewhere in your code
            },
          },
          FeatureTypes: ["QUERIES"],
        };

        const queries = [
          { Alias: "customerName", Text: "What's the name of customer?" },
          { Alias: "customerAddress", Text: "What's the address of customer?" },
          { Alias: "registrationNumber", Text: "What's the registration number?" },
          { Alias: "firstRegistered", Text: "When's the first registered of Vehicle?" },
          { Alias: "lenderName", Text: "What's the name of lender?" },
          { Alias: "lenderAddress", Text: "What's the address of lender?" },
          { Alias: "creditIntermediaryName", Text: "What's the name of Credit Intermediary?" },
          { Alias: "creditIntermediaryAddress", Text: "What's the address of Credit Intermediary?" },
          { Alias: "totalCashPrice", Text: "How much is the total cash Price of goods?" },
          { Alias: "advancePaymentCash", Text: "How much is the Advance Payment (Cash)?" },
          { Alias: "advancePaymentPartExchange", Text: "How much is the Advance Payment (Part Exchange)?" },
          { Alias: "amountOfCredit", Text: "How much is the amount of credit?" },
          { Alias: "financeCharges", Text: "How much is the Plus Finance Charges of Interest, Acceptance Fee, Purchase Fee?" },
          { Alias: "totalAmountPayable", Text: "How much is the Total Amount Payable?" },
          { Alias: "aprRate", Text: "How much is the percent of APR?" },
          { Alias: "agreementDuration", Text: "How many months are the Duration of agreement?" },
          { Alias: "finalMonthPayment", Text: "How much is the final month payment?" },
          { Alias: "monthlyPayments", Text: "How much is the monthly Payments?" },
          { Alias: "signatureDate", Text: "When was the signature on behalf of the lender made?" },
          { Alias: "agreementNumber", Text: "What's the agreement Number of contract document?" },
          { Alias: "vehicleMakeModel", Text: "What's the Make/Model of vehicle?" },
          { Alias: "vehicleVIN", Text: "What's the VIN number?" },
        ];

        const queryChunks = chunkArray(queries, 15);

        for (const queryChunk of queryChunks) {
          const analyzeDocumentRequest = {
            ...analyzeDocumentRequestTemplate,
            QueriesConfig: {
              Queries: queryChunk,
            },
          };

          const result = await textractClient.send(new AnalyzeDocumentCommand(analyzeDocumentRequest));
          const queryResultsById = {};

          // First, store all QUERY_RESULT blocks by their Id
          result.Blocks.forEach(block => {
            if (block.BlockType === "QUERY_RESULT") {
              queryResultsById[block.Id] = {
                Text: block.Text,
                Confidence: block.Confidence
              };
            }
          });

          // Next, find the corresponding QUERY_RESULT for each QUERY
          result.Blocks.forEach(block => {
            if (block.BlockType === "QUERY") {
              const answers = block.Relationships?.[0]?.Ids.map(id => queryResultsById[id]).filter(Boolean);
              if (answers && answers.length > 0) {
                textractResults.push({
                  QueryAlias: block.Query.Alias,
                  QuestionText: block.Query.Text,
                  AnswerText: answers.map(answer => answer.Text).join(' '), // Concatenate all parts of the answer
                  AnswerConfidence: answers.length > 0 ? answers[0].Confidence : undefined // Use the confidence of the first part of the answer
                });
              }
            }
          });
        }
      }
     // After processing all pages, return the combined results or save them as needed
      res.send(textractResults);
    } else {
      console.log("No text blocks found in the document.");
      res.status(404).send("No text blocks found in the document.");
    }
  } catch (error) {
    console.error("Error processing Textract job:", error);
    res.status(500).send("Error processing document: " + error.message);
  }
};

const uploadPDF = (req, res) => {
  upload(req, res, async (error) => {
    if (error instanceof multer.MulterError) {
      console.error('Multer Error:', error);
      res.status(500).send('Multer Error: ' + error.message);
      return;
    } else if (error) {
      console.error('Unknown Error:', error);
      res.status(500).send('Unknown Error: ' + error.message);
      return;
    } else if (req.file === undefined) {
      res.status(400).send('Error: No file selected.');
      return;
    }

    const inputPdfPath = req.file.path;
    const outputDir = path.join(__dirname, 'uploads', path.basename(req.file.originalname, path.extname(req.file.originalname)) + '_pages');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const pdfReader = hummus.createReader(inputPdfPath);
    const pageCount = pdfReader.getPagesCount();

    // This array will hold the keys for the uploaded files
    const s3Keys = [];
    const s3UploadPromises = [];

    try {
      for (let i = 0; i < pageCount; i++) {
        const pageFilePath = path.join(outputDir, `page_${i + 1}.pdf`);
        const pdfWriter = hummus.createWriter(pageFilePath);
        pdfWriter.appendPDFPagesFromPDF(inputPdfPath, { type: hummus.eRangeTypeSpecific, specificRanges: [[i, i]] });
        pdfWriter.end();

        // Read the content of the new PDF page file
        const pageFileContent = fs.readFileSync(pageFilePath);

        // Define the key for the new object in the S3 bucket
        const s3Key = `splitted-pages/${path.basename(pageFilePath)}`;

        // Add the key to the s3Keys array
        s3Keys.push(s3Key);

        // Create a PutObjectCommand to upload the file to S3
        const uploadParams = {
          Bucket: 'ocr-demo-bucket-advantage', // Replace with your bucket name
          Key: s3Key,
          Body: pageFileContent,
          ContentType: 'application/pdf',
        };

        // Push the upload promise to an array to execute them later
        s3UploadPromises.push(s3Client.send(new PutObjectCommand(uploadParams)));
      }

      // Use Promise.all to upload all the files to S3 concurrently
      await Promise.all(s3UploadPromises);

      // Send the response with the S3 keys of the uploaded files
      res.send({
        message: 'PDF split into pages and uploaded to S3 successfully.',
        s3Keys: s3Keys, // Include the keys in the response
      });
    } catch (err) {
      console.error('Error splitting PDF or uploading to S3:', err);
      res.status(500).send('Error splitting PDF or uploading to S3: ' + err.message);
    }
  });
};
module.exports = {
  getPresignedUrl,
  analyzePaystub,
  uploadPDF
};
