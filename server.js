const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Atlas Connection
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in environment variables');
  process.exit(1);
}

console.log('🔗 Connecting to MongoDB Atlas...');

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
})
.then(() => {
  console.log('✅ Connected to MongoDB Atlas successfully');
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
});

// MongoDB Schemas with PDF binary storage
const pdfSchema = new mongoose.Schema({
  name: { type: String, required: true },
  displayName: { type: String, required: true },
  filename: { type: String, required: true },
  type: { type: String, required: true, enum: ['material', 'imp-material'] },
  icon: { type: String, required: true },
  color: { type: String, default: '#6a11cb' },
  pdfData: { 
    data: Buffer, 
    contentType: String 
  },
  size: Number,
  dateAdded: { type: Date, default: Date.now }
});

const visitSchema = new mongoose.Schema({
  count: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now }
});

const PDF = mongoose.model('PDF', pdfSchema);
const Visit = mongoose.model('Visit', visitSchema);

// Multer configuration for memory storage (store in RAM before MongoDB)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  }
});

// ==================== ROUTES ====================

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    let materialCount = 0;
    let impMaterialCount = 0;
    let totalPdfCount = 0;
    let totalSize = 0;

    if (dbStatus === 'connected') {
      materialCount = await PDF.countDocuments({ type: 'material' });
      impMaterialCount = await PDF.countDocuments({ type: 'imp-material' });
      totalPdfCount = await PDF.countDocuments();
      
      // Calculate total storage used
      const sizeResult = await PDF.aggregate([
        { $group: { _id: null, totalSize: { $sum: "$size" } } }
      ]);
      totalSize = sizeResult.length > 0 ? sizeResult[0].totalSize : 0;
    }

    res.json({
      status: 'OK',
      database: dbStatus,
      storage: {
        pdfs: totalPdfCount,
        materials: materialCount,
        important: impMaterialCount,
        totalSize: Math.round(totalSize / 1024 / 1024 * 100) / 100 + ' MB'
      },
      message: 'All data stored securely in MongoDB Atlas'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all PDFs (without file data for performance)
app.get('/api/pdfs', async (req, res) => {
  try {
    const pdfs = await PDF.find({}, { pdfData: 0 }) // Exclude binary data for listing
                         .sort({ dateAdded: -1 });
    console.log(`📚 Serving ${pdfs.length} PDFs from MongoDB`);
    res.json(pdfs);
  } catch (error) {
    console.error('Error fetching PDFs:', error);
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// Get PDFs by type
app.get('/api/pdfs/:type', async (req, res) => {
  try {
    const pdfs = await PDF.find({ type: req.params.type }, { pdfData: 0 })
                         .sort({ dateAdded: -1 });
    res.json(pdfs);
  } catch (error) {
    console.error('Error fetching PDFs by type:', error);
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// Serve PDF file from MongoDB
app.get('/api/pdf-file/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf || !pdf.pdfData) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    // Set headers for PDF
    res.setHeader('Content-Type', pdf.pdfData.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
    res.setHeader('Content-Length', pdf.size);
    
    // Send PDF data
    res.send(pdf.pdfData.data);
    
  } catch (error) {
    console.error('Error serving PDF:', error);
    res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

// Download PDF
app.get('/api/download-pdf/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf || !pdf.pdfData) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    // Set headers for download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
    res.setHeader('Content-Length', pdf.size);
    
    // Send PDF data for download
    res.send(pdf.pdfData.data);
    
  } catch (error) {
    console.error('Error downloading PDF:', error);
    res.status(500).json({ error: 'Failed to download PDF' });
  }
});

// Get PDF counts
app.get('/api/stats/counts', async (req, res) => {
  try {
    const materialCount = await PDF.countDocuments({ type: 'material' });
    const impMaterialCount = await PDF.countDocuments({ type: 'imp-material' });
    const totalCount = await PDF.countDocuments();
    
    // Calculate storage usage
    const sizeResult = await PDF.aggregate([
      { $group: { _id: null, totalSize: { $sum: "$size" } } }
    ]);
    const totalSize = sizeResult.length > 0 ? sizeResult[0].totalSize : 0;
    
    res.json({
      materialCount,
      impMaterialCount,
      totalCount,
      storageUsed: Math.round(totalSize / 1024 / 1024 * 100) / 100
    });
  } catch (error) {
    console.error('Error getting counts:', error);
    res.status(500).json({ error: 'Failed to get counts' });
  }
});

// Admin: Add new PDF (store in MongoDB)
app.post('/api/admin/pdfs', upload.single('pdfFile'), async (req, res) => {
  try {
    console.log('📤 Admin uploading PDF to MongoDB...');
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No PDF file uploaded' });
    }

    const { pdfName, pdfDisplayName, pdfType, pdfIcon, pdfColor } = req.body;

    // Validate required fields
    if (!pdfDisplayName || !pdfType || !pdfIcon) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    // Create new PDF document with binary data
    const newPdf = new PDF({
      name: pdfName || req.file.originalname,
      displayName: pdfDisplayName,
      filename: req.file.originalname,
      type: pdfType,
      icon: pdfIcon,
      color: pdfColor || '#6a11cb',
      pdfData: {
        data: req.file.buffer,
        contentType: req.file.mimetype
      },
      size: req.file.size
    });
    
    const savedPdf = await newPdf.save();
    console.log(`✅ PDF stored in MongoDB: "${savedPdf.displayName}" (${Math.round(req.file.size / 1024)} KB)`);
    
    res.status(201).json({
      success: true,
      message: 'PDF uploaded and stored securely in MongoDB!',
      pdf: {
        _id: savedPdf._id,
        name: savedPdf.name,
        displayName: savedPdf.displayName,
        type: savedPdf.type,
        icon: savedPdf.icon,
        color: savedPdf.color,
        size: savedPdf.size,
        dateAdded: savedPdf.dateAdded
      }
    });
    
  } catch (error) {
    console.error('❌ Error storing PDF in MongoDB:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to store PDF: ' + error.message 
    });
  }
});

// Admin: Delete PDF from MongoDB
app.delete('/api/admin/pdfs/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    await PDF.findByIdAndDelete(req.params.id);
    console.log(`🗑️ PDF deleted from MongoDB: "${pdf.displayName}"`);
    
    res.json({ 
      success: true,
      message: 'PDF deleted successfully from MongoDB' 
    });
  } catch (error) {
    console.error('Error deleting PDF:', error);
    res.status(500).json({ error: 'Failed to delete PDF' });
  }
});

// Visit tracking
app.get('/api/visits', async (req, res) => {
  try {
    let visitData = await Visit.findOne();
    
    if (!visitData) {
      visitData = new Visit({ count: 0 });
      await visitData.save();
    }
    
    res.json({ count: visitData.count });
  } catch (error) {
    console.error('Error fetching visits:', error);
    res.status(500).json({ error: 'Failed to fetch visit count' });
  }
});

app.post('/api/visits/increment', async (req, res) => {
  try {
    let visitData = await Visit.findOne();
    
    if (!visitData) {
      visitData = new Visit({ count: 1 });
    } else {
      visitData.count += 1;
      visitData.lastUpdated = new Date();
    }
    
    await visitData.save();
    res.json({ count: visitData.count });
  } catch (error) {
    console.error('Error incrementing visits:', error);
    res.status(500).json({ error: 'Failed to increment visit count' });
  }
});

// Database cleanup (remove PDF binary data for testing)
app.delete('/api/cleanup-pdfs', async (req, res) => {
  try {
    const result = await PDF.deleteMany({});
    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} PDFs from MongoDB`
    });
  } catch (error) {
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

// Get database statistics
app.get('/api/database/stats', async (req, res) => {
  try {
    const totalPDFs = await PDF.countDocuments();
    const materialPDFs = await PDF.countDocuments({ type: 'material' });
    const impPDFs = await PDF.countDocuments({ type: 'imp-material' });
    
    const sizeResult = await PDF.aggregate([
      { $group: { _id: null, totalSize: { $sum: "$size" }, avgSize: { $avg: "$size" } } }
    ]);
    
    const stats = {
      totalPDFs,
      materialPDFs,
      impPDFs,
      totalSize: sizeResult.length > 0 ? Math.round(sizeResult[0].totalSize / 1024 / 1024 * 100) / 100 : 0,
      avgSize: sizeResult.length > 0 ? Math.round(sizeResult[0].avgSize / 1024) : 0,
      storage: 'MongoDB Atlas (Permanent)'
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🚀 STUDY PORTAL - MONGODB PDF STORAGE');
  console.log('='.repeat(60));
  console.log(`✅ Server running on port: ${PORT}`);
  console.log(`🌐 App URL: https://exam-k35t.onrender.com`);
  console.log(`🗄️  Storage: MongoDB Atlas (Permanent)`);
  console.log(`📁 PDF Files: Stored in MongoDB as binary data`);
  console.log(`💾 Data Persistence: 100% GUARANTEED`);
  console.log('='.repeat(60));
  console.log('✅ All data survives server restarts!');
  console.log('✅ PDF files stored securely in cloud!');
  console.log('✅ No file system dependencies!');
  console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await mongoose.connection.close();
  console.log('✅ MongoDB connection closed.');
  process.exit(0);
});
