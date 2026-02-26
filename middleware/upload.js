const multer = require('multer');
const path = require('path');

// Configure storage (in-memory buffers for quick parsing, or temp file, use memory for simpler CSV parse)
const storage = multer.memoryStorage();

// File filter to accept CSV only
const fileFilter = (req, file, cb) => {
    // Check extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv') {
        cb(null, true);
    } else {
        cb(new Error('Only CSV files are allowed!'), false);
    }
    // Could also check mimetype, but CSV types vary (application/vnd.ms-excel, text/csv, etc.)
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

module.exports = upload;
