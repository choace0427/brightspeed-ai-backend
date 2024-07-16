const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { DeleteObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { resError, resSuccess } = require("../utils/responseMessage");
const { s3Client } = require("../config/s3Client");
const AWS = require("../config/aws-config");
const multer = require('multer');
const path = require('path');
const hummus = require('hummus');
const moment = require('moment');
const {
  TextractClient,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
  AnalyzeIDCommand,
  AnalyzeDocumentCommand
} = require("@aws-sdk/client-textract");


const fs = require('fs').promises;
// Initialize the Textract client
const textractClient = new TextractClient({
  region: "eu-west-2", // Specify your AWS region
});

require("dotenv").config();

const textract = new AWS.Textract();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const upload = multer({ storage: storage });

function convertToDateFormat(dateStr, dateType) {
  // Define month mapping with French short names
  const monthMapping = {
    'JAN': '01', 'JANVIER': '01', 'JANV': '01',
    'FEB': '02', 'FEVRIER': '02', 'FEV': '02',
    'MAR': '03', 'MARS': '03',
    'APR': '04', 'AVRIL': '04', 'AVR': '04',
    'MAY': '05', 'MAI': '05',
    'JUN': '06', 'JUIN': '06', 'JUI': '06',
    'JUL': '07', 'JUILLET': '07', 'JUL': '07',
    'AUG': '08', 'AOUT': '08', 'AOÛ': '08',
    'SEP': '09', 'SEPTEMBRE': '09', 'SEP': '09',
    'OCT': '10', 'OCTOBRE': '10', 'OCT': '10',
    'NOV': '11', 'NOVEMBRE': '11', 'NOV': '11',
    'DEC': '12', 'DECEMBRE': '12', 'DÉC': '12'
  };

  // Helper function to map month names to numbers
  function getMonthNumber(month) {
    return monthMapping[month.toUpperCase()] || month;
  }

  let day, month, year;

  // Split input date based on spaces or dots
  if (dateStr.includes(' ')) {
    const parts = dateStr.split(' ');
    day = parts[0];

    if (parts.length === 5) { // Case: 07 JUN / JUIN 94
      month = getMonthNumber(parts[1]);
      if (dateType === 'DateOfBirth')
        year = Number(parts[4]) < 30 ? '20' + parts[4] : '19' + parts[4];
      else
        year = '20' + parts[4]
    } else if (parts.length === 4) { // Case: 07 JUN / JUIN 94
        month = getMonthNumber(parts[1]);
      if (dateType === 'DateOfBirth')
        year = Number(parts[3]) < 30 ? '20' + parts[3] : '19' + parts[3];
      else
        year = '20' + parts[3]
    } else if (parts.length === 3) { // Case: 01 ME/JUN 2024 or 16 JUL 2024
      month = getMonthNumber(parts[1].split('/')[1] || parts[1]);
      year = parts[2];
    }
  } else if (dateStr.includes('.')) { // Case: 20.05.2023
    const parts = dateStr.split('.');
    day = parts[0];
    month = parts[1];
    year = parts[2];
  } else {
    return null;
  }

  // Ensure day and month are two digits
  // day = day.padStart(2, '0');
  // month = month.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function calculateAge(birthDateStr) {
  // Parse the input date string
  const birthDate = new Date(birthDateStr);
  const today = new Date();

  let age = today.getFullYear() - birthDate.getFullYear();
  return age;
}

function checkPassportData(userIdData, firstName, lastName, dob) {
  console.log(firstName, lastName, dob)
  var extractedData = {}
  userIdData.map((item) => {
    if (item.QueryAlias === 'DateOfBirth' || item.QueryAlias === 'IssueDate' || item.QueryAlias === 'ExpireDate') {
      extractedData[item.QueryAlias] = convertToDateFormat(item.AnswerText,  item.QueryAlias);
      if (item.QueryAlias === 'DateOfBirth')
        extractedData['Age'] = calculateAge(extractedData[item.QueryAlias]);
    } else if (item.QueryAlias === 'Sex') {
      extractedData[item.QueryAlias] = item.AnswerText === "M" || item.AnswerText === "MR" ? "M" : "F";
    } else {
    extractedData[item.QueryAlias] = item.AnswerText;
  }});
  console.log(extractedData);
  const mismatches = [];

  if (extractedData.GivenName.toLowerCase() !== firstName.toLowerCase() || extractedData.Surname.toLowerCase() !== lastName.toLowerCase()) {
    mismatches.push({ field: 'name', message: 'Mis Matching Name' });
  }

  if (extractedData.DateOfBirth !== dob) {
    mismatches.push({ field: 'dob', message: 'Mis Matching DOB' });
  }
  //
  const parsedIssuedDate = new Date(extractedData.IssueDate);
  const parsedExpiryDate = new Date(extractedData.ExpireDate);
  const parsedCurrentDate = new Date();

  if (parsedExpiryDate <= parsedIssuedDate) {
    mismatches.push({ field: 'expiryDate', message: 'Expiry date must be after the issued date' });
  }

  if (parsedCurrentDate >= parsedExpiryDate) {
    mismatches.push({ field: 'expiryDate', message: 'Expiry date has expired' });
  }

  const status = mismatches.length === 0 ? 'success' : 'failure';

  return {
    status,
    mismatches,
    extractedData
  };
}

const startDocumentAnalysis = async (s3Key, queries, adapterId, adapterVersion) => {
  const params = {
    AdaptersConfig: {
      Adapters: [
        {
          AdapterId: adapterId, // Use the provided Adapter ID
          Pages: ["1"], // Specify the pages to apply the adapter
          Version: adapterVersion, // Use the provided adapter version
        },
      ],
    },
    DocumentLocation: {
      S3Object: {
        Bucket: 'ocr-demo-bucket-advantage',
        Name: s3Key,
      },
    },
    FeatureTypes: ['QUERIES'],
    QueriesConfig: {
      Queries: queries, // Use the provided queries
    },
  };

  const command = new StartDocumentAnalysisCommand(params);
  const response = await textractClient.send(command);
  return response.JobId;
};


const retryWithBackoff = async (fn, retries = 5, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.name === 'ProvisionedThroughputExceededException' || err.name === 'ThrottlingException') {
        const backoffDelay = delay * Math.pow(2, i); // Exponential backoff
        console.warn(`Retrying after delay: ${backoffDelay}ms`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Failed after ${retries} attempts`);
};

const getDocumentAnalysis = async (jobId, maxRetries = 20, delay = 5000) => {
  let finished = false;
  let nextToken = undefined;
  const blocks = [];
  let retries = 0;

  while (!finished && retries < maxRetries) {
    const params = {
      JobId: jobId,
      NextToken: nextToken,
    };

    const command = new GetDocumentAnalysisCommand(params);

    try {
      const response = await retryWithBackoff(() => textractClient.send(command));

      if (response.JobStatus === 'SUCCEEDED') {
        if (response.Blocks) {
          blocks.push(...response.Blocks);
        }
        nextToken = response.NextToken;
        finished = !nextToken;
      } else if (response.JobStatus === 'FAILED') {
        throw new Error('Textract job failed');
      } else {
        console.log('Textract job status:', response.JobStatus);
        retries++;
        await new Promise(resolve => setTimeout(resolve, delay)); // Wait before retrying
      }
    } catch (error) {
      console.error('Error in getDocumentAnalysis:', error);
      retries++;
      await new Promise(resolve => setTimeout(resolve, delay)); // Wait before retrying
    }
  }

  if (!finished) {
    throw new Error('Textract job did not complete within the maximum number of retries');
  }

  return blocks;
};

const analyzePDF = async (req, res) => {
  try {
    const { allS3Keys, queries, adapterId, adapterVersion } = req.body; // Assuming the request body contains these parameters

    if (!allS3Keys || !Array.isArray(allS3Keys)) {
      console.log("Invalid request body.");
      res.status(400).send("Invalid request body.");
      return;
    }

    // Prepare to store the Textract results grouped by PDF file
    const pdfResults = await Promise.all(allS3Keys.map(async (pdf) => {
      const { fileName, s3Keys } = pdf;
      console.log(`Processing PDF: ${fileName}`);

      const textractResults = [];

      await Promise.all(s3Keys.map(async (s3Key, index) => {
        await delay(index * 5000); // Delay each request by index * 3000ms (adjust as needed)
        const jobId = await startDocumentAnalysis(s3Key, queries, adapterId, adapterVersion);
        const blocks = await getDocumentAnalysis(jobId);

        // Process the blocks to extract the query results
        const queryResultsById = {};
        const bestAnswersByQueryAlias = {}; // Store best answers by query alias

        blocks.forEach(block => {
          if (block.BlockType === "QUERY_RESULT") {
            queryResultsById[block.Id] = {
              Text: block.Text,
              Confidence: block.Confidence
            };
          }
        });

        blocks.forEach(block => {
          if (block.BlockType === "QUERY") {
            const answers = block.Relationships?.[0]?.Ids.map(id => queryResultsById[id]).filter(Boolean);
            if (answers) {
              answers.forEach(answer => {
                const queryAlias = block.Query.Alias;
                // Check if we already have a better answer for this query alias
                if (!bestAnswersByQueryAlias[queryAlias] || bestAnswersByQueryAlias[queryAlias].Confidence < answer.Confidence) {
                  bestAnswersByQueryAlias[queryAlias] = {
                    QueryAlias: queryAlias,
                    QuestionText: block.Query.Text,
                    AnswerText: answer.Text,
                    AnswerConfidence: answer.Confidence
                  };
                }
              });
            }
          }
        });

        // Add the best answers for this PDF to the textractResults array
        Object.values(bestAnswersByQueryAlias).forEach(bestAnswer => textractResults.push(bestAnswer));
      }));

      const uniqueTextractResults = {};
      textractResults.forEach(result => {
        const alias = result.QueryAlias;
        if (!uniqueTextractResults[alias] || uniqueTextractResults[alias].AnswerConfidence < result.AnswerConfidence) {
          uniqueTextractResults[alias] = result;
        }
      });

      // Convert the unique results back into an array
      const filteredResults = Object.values(uniqueTextractResults);

      // Return the results for this PDF
      return {
        fileName: fileName,
        data: filteredResults
      };
    }));

    // Return the combined results grouped by PDF file
    res.send(pdfResults);

  } catch (error) {
    console.error("Error processing Textract job:", error);
    res.status(500).send("Error processing document: " + error.message);
  }
};

const uploadFiles = async (req, res) => {
  const rootUploadsDir = path.join(__dirname, '..', 'uploads'); // Path to the root uploads directory
  // Ensure the root uploads directory exists
  await fs.mkdir(rootUploadsDir, { recursive: true });

  upload.array('files')(req, res, async (error) => {
    if (error instanceof multer.MulterError) {
      console.error('Multer Error:', error);
      res.status(500).send('Multer Error: ' + error.message);
      return;
    } else if (error) {
      console.error('Unknown Error:', error);
      res.status(500).send('Unknown Error: ' + error.message);
      return;
    } else if (!req.files || req.files.length === 0) {
      res.status(400).send('Error: No files selected.');
      return;
    }

    try {



      const allS3Keys = [];

      for (const file of req.files) {
        const inputFilePath = file.path;
        const uniqueDirName = path.basename(file.originalname, path.extname(file.originalname)) + '_' + Date.now();

        if (file.mimetype === 'application/pdf') {
          // Handle PDF file
          const outputDir = path.join(__dirname, 'uploads', uniqueDirName);
          await fs.mkdir(outputDir, { recursive: true });

          const pdfReader = hummus.createReader(inputFilePath);
          const pageCount = pdfReader.getPagesCount();

          // This array will hold the keys for the uploaded files of the current PDF
          const s3Keys = [];
          const s3UploadPromises = [];

          for (let i = 0; i < pageCount; i++) {
            const pageFilePath = path.join(outputDir, `page_${i + 1}.pdf`);
            const pdfWriter = hummus.createWriter(pageFilePath);
            pdfWriter.appendPDFPagesFromPDF(inputFilePath, { type: hummus.eRangeTypeSpecific, specificRanges: [[i, i]] });
            pdfWriter.end();

            // Read the content of the new PDF page file
            const pageFileContent = await fs.readFile(pageFilePath);

            // Define the key for the new object in the S3 bucket
            const s3Key = `splitted-pages/${uniqueDirName}/page_${i + 1}.pdf`;

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

          // Add the keys for the current PDF to the allS3Keys array
          allS3Keys.push({
            fileName: file.originalname,
            s3Keys: s3Keys,
          });
        } else if (file.mimetype.startsWith('image/')) {
          // Handle image file
          const imageFileContent = await fs.readFile(inputFilePath);
          const s3Key = `uploaded-images/${uniqueDirName}${path.extname(file.originalname)}`;

          // Create a PutObjectCommand to upload the file to S3
          const uploadParams = {
            Bucket: 'ocr-demo-bucket-advantage', // Replace with your bucket name
            Key: s3Key,
            Body: imageFileContent,
            ContentType: file.mimetype,
          };

          // Upload the image to S3
          await s3Client.send(new PutObjectCommand(uploadParams));

          // Add the key to the allS3Keys array
          allS3Keys.push({
            fileName: file.originalname,
            s3Keys: [s3Key],
          });
          // await unlinkAsync(file.path)
          // Note: Removed the file deletion logic
        } else {
          console.error('Unsupported file type:', file.mimetype);
          res.status(400).send('Error: Unsupported file type.');
          return;
        }

        // Note: Removed the file deletion logic for the original file
      }

      // Send the response with the S3 keys of the uploaded files
      res.send({
        message: 'Files uploaded to S3 successfully.',
        allS3Keys: allS3Keys, // Include the keys in the response
      });
    } catch (err) {
      console.error('Error processing files or uploading to S3:', err);
      res.status(500).send('Error processing files or uploading to S3: ' + err.message);
    }
  });
};


const iDCardFiles = async (req, res) => {
  const rootUploadsDir = path.join(__dirname, '..', 'uploads'); // Path to the root uploads directory
  await fs.mkdir(rootUploadsDir, { recursive: true });

  upload.array('id_card')(req, res, async (error) => {
    if (error instanceof multer.MulterError) {
      console.error('Multer Error:', error);
      res.status(500).send('Multer Error: ' + error.message);
      return;
    } else if (error) {
      console.error('Unknown Error:', error);
      res.status(500).send('Unknown Error: ' + error.message);
      return;
    } else if (!req.files || req.files.length === 0) {
      res.status(400).send('Error: No files selected.');
      return;
    }
    console.log(req.body)
    const {first_name, last_name, email, lender_name, phone, birth, country, state, street, zip} = req.body;
    try {
      let idS3Key = {};
      const file = req.files[0];
      const inputFilePath = file.path;
      const uniqueDirName = path.basename(file.originalname, path.extname(file.originalname)) + '_' + Date.now();

      if (file.mimetype.startsWith('image/')) {
          // Handle image file
          const imageFileContent = await fs.readFile(inputFilePath);
          const s3Key = `uploaded_id_images/${uniqueDirName}${path.extname(file.originalname)}`;

          // Create a PutObjectCommand to upload the file to S3
          const uploadParams = {
            Bucket: 'ocr-demo-bucket-advantage', // Replace with your bucket name
            Key: s3Key,
            Body: imageFileContent,
            ContentType: file.mimetype,
          };

          // Upload the image to S3
          await s3Client.send(new PutObjectCommand(uploadParams));
          idS3Key = s3Key

        } else {
          console.error('Unsupported file type:', file.mimetype);
          res.status(400).send('Error: Unsupported file type.');
          return;
        }

        // Note: Removed the file deletion logic for the original file
      const client = new TextractClient({region: "eu-west-2"});

      const analyzeDocumentRequest = {
        AdaptersConfig: {
          Adapters: [
            {
              AdapterId: "1d4ba44bfc6b", // Replace with your Adapter ID
              Pages: ["1"], // Specify the pages to apply the adapter
              Version: '1', // Replace with the adapter version
            },
          ],
        },
        Document: {
          S3Object: {
            Bucket: "ocr-demo-bucket-advantage",
            Name: idS3Key,
          },
        },
        FeatureTypes: ["QUERIES"],
        QueriesConfig: {
          Queries: [
            { Text: "What's the surname?", Alias: "Surname" },
            { Text: "What's the given name?", Alias: "GivenName" },
            { Text: "What's the middle name?", Alias: "MiddleName" },
            { Text: "What's the date of birthday?", Alias: "DateOfBirth" },
            { Text: "What's the issue date?", Alias: "IssueDate" },
            { Text: "What's the expire date?", Alias: "ExpireDate" },
            { Text: "What's the street and number?", Alias: "StreetAndNumber" },
            { Text: "What's the city?", Alias: "City" },
            { Text: "What's the postal code?", Alias: "PostalCode" },
            { Text: "What's the Driving Licence Number?", Alias: "DrivingLicenceNumber" },
            { Text: "What's the passport Number?", Alias: "PassportNumber" },
            { Text: "What's the sex?", Alias: "Sex" },
            { Text: "What's the country?", Alias: "Country" },
            { Text: "What's the place of birth in the passport?", Alias: "PlaceOfBirth" },
          ],
        },
      };


      const result = await client.send(new AnalyzeDocumentCommand(analyzeDocumentRequest));
      const queryResultsById = {};
      const textractResults = [];
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
      const mis_result  = checkPassportData(textractResults, first_name, last_name, birth );
      res.json(mis_result);
    } catch (err) {
      console.error('Error processing files or uploading to S3:', err);
      res.status(500).send('Error processing files or uploading to S3: ' + err.message);
    }
  });
};

const deleteAllUploads = async (req, res) => {
  const directory = path.join(__dirname, 'uploads');
  const rootUploadsDir = path.join(__dirname, '..', 'uploads');
  const deleteDirectoryContents = async (dir) => {
    const files = await fs.readdir(dir);
    await Promise.all(files.map(async (file) => {
      const filePath = path.join(dir, file);
      const stats = await fs.lstat(filePath);
      if (stats.isDirectory()) {
        await deleteDirectoryContents(filePath);
        await fs.rmdir(filePath);
      } else {
        await fs.unlink(filePath);
      }
    }));
  };

  try {
    await deleteDirectoryContents(directory);
    await fs.rmdir(rootUploadsDir, { recursive: true, force: true});
    res.send({ message: 'All files and directories in the uploads folder have been deleted successfully.' });
  } catch (err) {
    console.error('Error deleting uploads folder contents:', err);
    res.status(500).send('Error deleting uploads folder contents: ' + err.message);
  }
};

module.exports = {
  analyzePDF,
  uploadFiles,
  deleteAllUploads,
  iDCardFiles
};








///////////////////////

/*

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
const fs = require('fs').promises;

// Initialize the Textract client
const textractClient = new TextractClient({
  region: "eu-west-2", // Specify your AWS region
});

require("dotenv").config();

const textract = new AWS.Textract();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage: storage });

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

const chunkArray = (array, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
};

const analyzePDF = async (req, res) => {
  try {
    const { allS3Keys, queries, adapterId, adapterVersion } = req.body; // Assuming the request body contains these parameters

    if (!allS3Keys || !Array.isArray(allS3Keys)) {
      console.log("Invalid request body.");
      res.status(400).send("Invalid request body.");
      return;
    }

    // Prepare to store the Textract results grouped by PDF file
    const pdfResults = [];

    for (const pdf of allS3Keys) {
      const { fileName, s3Keys } = pdf;
      console.log(`Processing PDF: ${fileName}`);

      const textractResults = [];

      for (const s3Key of s3Keys) {
        const analyzeDocumentRequestTemplate = {
          AdaptersConfig: {
            Adapters: [
              {
                AdapterId: adapterId, // Replace with your Adapter ID
                Pages: ["1"], // Specify the pages to apply the adapter
                Version: adapterVersion, // Replace with the adapter version
              },
            ],
          },
          Document: {
            S3Object: {
              Bucket: "ocr-demo-bucket-advantage",
              Name: s3Key,
            },
          },
          FeatureTypes: ["QUERIES"],
        };

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

      // Add the results for this PDF to the overall results array
      pdfResults.push({
        fileName: fileName,
        data: textractResults
      });
    }

    // Return the combined results grouped by PDF file
    res.send(pdfResults);

  } catch (error) {
    console.error("Error processing Textract job:", error);
    res.status(500).send("Error processing document: " + error.message);
  }
};

const uploadFiles = async (req, res) => {
  const rootUploadsDir = path.join(__dirname, '..', 'uploads'); // Path to the root uploads directory
  // Ensure the root uploads directory exists
  await fs.mkdir(rootUploadsDir, { recursive: true });

  upload.array('files')(req, res, async (error) => {
    if (error instanceof multer.MulterError) {
      console.error('Multer Error:', error);
      res.status(500).send('Multer Error: ' + error.message);
      return;
    } else if (error) {
      console.error('Unknown Error:', error);
      res.status(500).send('Unknown Error: ' + error.message);
      return;
    } else if (!req.files || req.files.length === 0) {
      res.status(400).send('Error: No files selected.');
      return;
    }

    try {



      const allS3Keys = [];

      for (const file of req.files) {
        const inputFilePath = file.path;
        const uniqueDirName = path.basename(file.originalname, path.extname(file.originalname)) + '_' + Date.now();

        if (file.mimetype === 'application/pdf') {
          // Handle PDF file
          const outputDir = path.join(__dirname, 'uploads', uniqueDirName);
          await fs.mkdir(outputDir, { recursive: true });

          const pdfReader = hummus.createReader(inputFilePath);
          const pageCount = pdfReader.getPagesCount();

          // This array will hold the keys for the uploaded files of the current PDF
          const s3Keys = [];
          const s3UploadPromises = [];

          for (let i = 0; i < pageCount; i++) {
            const pageFilePath = path.join(outputDir, `page_${i + 1}.pdf`);
            const pdfWriter = hummus.createWriter(pageFilePath);
            pdfWriter.appendPDFPagesFromPDF(inputFilePath, { type: hummus.eRangeTypeSpecific, specificRanges: [[i, i]] });
            pdfWriter.end();

            // Read the content of the new PDF page file
            const pageFileContent = await fs.readFile(pageFilePath);

            // Define the key for the new object in the S3 bucket
            const s3Key = `splitted-pages/${uniqueDirName}/page_${i + 1}.pdf`;

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

          // Add the keys for the current PDF to the allS3Keys array
          allS3Keys.push({
            fileName: file.originalname,
            s3Keys: s3Keys,
          });
        } else if (file.mimetype.startsWith('image/')) {
          // Handle image file
          const imageFileContent = await fs.readFile(inputFilePath);
          const s3Key = `uploaded-images/${uniqueDirName}${path.extname(file.originalname)}`;

          // Create a PutObjectCommand to upload the file to S3
          const uploadParams = {
            Bucket: 'ocr-demo-bucket-advantage', // Replace with your bucket name
            Key: s3Key,
            Body: imageFileContent,
            ContentType: file.mimetype,
          };

          // Upload the image to S3
          await s3Client.send(new PutObjectCommand(uploadParams));

          // Add the key to the allS3Keys array
          allS3Keys.push({
            fileName: file.originalname,
            s3Keys: [s3Key],
          });
          // await unlinkAsync(file.path)
          // Note: Removed the file deletion logic
        } else {
          console.error('Unsupported file type:', file.mimetype);
          res.status(400).send('Error: Unsupported file type.');
          return;
        }

        // Note: Removed the file deletion logic for the original file
      }

      // Send the response with the S3 keys of the uploaded files
      res.send({
        message: 'Files uploaded to S3 successfully.',
        allS3Keys: allS3Keys, // Include the keys in the response
      });
    } catch (err) {
      console.error('Error processing files or uploading to S3:', err);
      res.status(500).send('Error processing files or uploading to S3: ' + err.message);
    }
  });
};


const deleteAllUploads = async (req, res) => {
  const directory = path.join(__dirname, 'uploads');
  const rootUploadsDir = path.join(__dirname, '..', 'uploads');
  const deleteDirectoryContents = async (dir) => {
    const files = await fs.readdir(dir);
    await Promise.all(files.map(async (file) => {
      const filePath = path.join(dir, file);
      const stats = await fs.lstat(filePath);
      if (stats.isDirectory()) {
        await deleteDirectoryContents(filePath);
        await fs.rmdir(filePath);
      } else {
        await fs.unlink(filePath);
      }
    }));
  };

  try {
    await deleteDirectoryContents(directory);
    await fs.rmdir(rootUploadsDir, { recursive: true, force: true});
    res.send({ message: 'All files and directories in the uploads folder have been deleted successfully.' });
  } catch (err) {
    console.error('Error deleting uploads folder contents:', err);
    res.status(500).send('Error deleting uploads folder contents: ' + err.message);
  }
};
module.exports = {
  analyzePDF,
  uploadFiles,
  deleteAllUploads
};

*/
