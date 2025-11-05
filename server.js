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

// MongoDB Atlas Connection - PERMANENT STORAGE
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in environment variables');
  console.log('💡 Please set MONGODB_URI in Render environment variables');
  process.exit(1);
}

console.log('🔗 Connecting to MongoDB Atlas...');

// MongoDB connection with persistent storage
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
})
.then(() => {
  console.log('✅ Connected to MongoDB Atlas successfully');
  console.log('💾 Database: Permanent storage enabled');
  console.log('📊 Data will survive server restarts');
})
.catch(err => {
  console.error('❌ MongoDB connection failed:', err.message);
  console.log('💡 Please check:');
  console.log('1. MONGODB_URI in Render environment variables');
  console.log('2. Network Access in MongoDB Atlas (add 0.0.0.0/0)');
  console.log('3. Database user credentials');
  process.exit(1);
});

// MongoDB Schemas - PERMANENT STORAGE
const pdfSchema = new mongoose.Schema({
  name: { type: String, required: true },
  displayName: { type: String, required: true },
  filename: { type: String, required: true },
  path: { type: String, required: true },
  type: { type: String, required: true },
  icon: { type: String, required: true },
  color: { type: String, default: '#6a11cb' },
  fileBuffer: { type: Buffer, required: true }, // Store PDF file in MongoDB
  fileSize: { type: Number, required: true },
  uploadDate: { type: Date, default: Date.now }
});

const visitSchema = new mongoose.Schema({
  count: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now }
});

const PDF = mongoose.model('PDF', pdfSchema);
const Visit = mongoose.model('Visit', visitSchema);

// Multer configuration - Store files in memory to save to MongoDB
const storage = multer.memoryStorage(); // Store file in memory

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ==================== ROUTES ====================

// Health check with MongoDB status
app.get('/api/health', async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const pdfCount = await PDF.countDocuments();
    const visitData = await Visit.findOne();
    
    res.json({
      status: 'OK',
      database: {
        mongodb: dbStatus,
        storage: 'permanent',
        pdfCount: pdfCount
      },
      server: {
        uptime: process.uptime(),
        restartProof: true
      },
      message: 'Data persists through server restarts'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all PDFs from MongoDB
app.get('/api/pdfs', async (req, res) => {
  try {
    const pdfs = await PDF.find().sort({ uploadDate: -1 });
    console.log(`📚 Serving ${pdfs.length} PDFs from MongoDB`);
    
    // Return PDF metadata (not the file buffer)
    const pdfList = pdfs.map(pdf => ({
      _id: pdf._id,
      name: pdf.name,
      displayName: pdf.displayName,
      filename: pdf.filename,
      path: `/api/pdf/${pdf._id}`, // API endpoint to serve PDF
      type: pdf.type,
      icon: pdf.icon,
      color: pdf.color,
      fileSize: pdf.fileSize,
      uploadDate: pdf.uploadDate
    }));
    
    res.json(pdfList);
  } catch (error) {
    console.error('Error fetching PDFs:', error);
    res.status(500).json({ error: 'Failed to fetch PDFs from database' });
  }
});

// Get PDFs by type from MongoDB
app.get('/api/pdfs/:type', async (req, res) => {
  try {
    const pdfs = await PDF.find({ type: req.params.type }).sort({ uploadDate: -1 });
    
    const pdfList = pdfs.map(pdf => ({
      _id: pdf._id,
      name: pdf.name,
      displayName: pdf.displayName,
      filename: pdf.filename,
      path: `/api/pdf/${pdf._id}`,
      type: pdf.type,
      icon: pdf.icon,
      color: pdf.color,
      fileSize: pdf.fileSize,
      uploadDate: pdf.uploadDate
    }));
    
    res.json(pdfList);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// ✅ SERVE PDF FILE FROM MONGODB
app.get('/api/pdf/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    // Set proper headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.name}"`);
    res.setHeader('Content-Length', pdf.fileSize);
    
    // Send the PDF buffer stored in MongoDB
    res.send(pdf.fileBuffer);
    
    console.log(`📄 Served PDF from MongoDB: ${pdf.displayName}`);
  } catch (error) {
    console.error('Error serving PDF:', error);
    res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

// ✅ DOWNLOAD PDF FROM MONGODB
app.get('/api/download-pdf/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    // Set download headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.name}"`);
    res.setHeader('Content-Length', pdf.fileSize);
    
    // Send the PDF buffer for download
    res.send(pdf.fileBuffer);
    
    console.log(`📥 Downloaded PDF from MongoDB: ${pdf.displayName}`);
  } catch (error) {
    res.status(500).json({ error: 'Failed to download PDF' });
  }
});

// Get counts from MongoDB
app.get('/api/stats/counts', async (req, res) => {
  try {
    const materialCount = await PDF.countDocuments({ type: 'material' });
    const impMaterialCount = await PDF.countDocuments({ type: 'imp-material' });
    const totalCount = await PDF.countDocuments();
    
    res.json({
      materialCount,
      impMaterialCount,
      totalCount
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get counts' });
  }
});

// ✅ ADMIN: UPLOAD PDF TO MONGODB (PERMANENT STORAGE)
app.post('/api/admin/pdfs', upload.single('pdfFile'), async (req, res) => {
  try {
    console.log('📤 Uploading PDF to MongoDB...');
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { pdfName, pdfDisplayName, pdfType, pdfIcon, pdfColor } = req.body;

    if (!pdfDisplayName || !pdfType || !pdfIcon) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    // Create PDF document with file buffer
    const newPdf = new PDF({
      name: pdfName || req.file.originalname,
      displayName: pdfDisplayName,
      filename: req.file.originalname,
      path: `/api/pdf/`, // Will be set with ID
      type: pdfType,
      icon: pdfIcon,
      color: pdfColor || '#6a11cb',
      fileBuffer: req.file.buffer, // Store file in MongoDB
      fileSize: req.file.size
    });

    const savedPdf = await newPdf.save();
    
    // Update path with actual ID
    savedPdf.path = `/api/pdf/${savedPdf._id}`;
    await savedPdf.save();

    console.log(`✅ PDF stored in MongoDB: "${savedPdf.displayName}"`);
    console.log(`💾 File size: ${(savedPdf.fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`🆔 MongoDB ID: ${savedPdf._id}`);

    res.json({
      success: true,
      message: 'PDF stored permanently in MongoDB Atlas!',
      pdf: {
        _id: savedPdf._id,
        name: savedPdf.name,
        displayName: savedPdf.displayName,
        path: savedPdf.path,
        type: savedPdf.type,
        icon: savedPdf.icon,
        color: savedPdf.color,
        fileSize: savedPdf.fileSize,
        uploadDate: savedPdf.uploadDate
      }
    });

  } catch (error) {
    console.error('❌ MongoDB upload error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to upload to MongoDB: ' + error.message 
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
      message: 'PDF deleted from MongoDB' 
    });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
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
    res.status(500).json({ error: 'Failed to increment visit count' });
  }
});

// Database info endpoint
app.get('/api/database/info', async (req, res) => {
  try {
    const pdfCount = await PDF.countDocuments();
    const totalSize = await PDF.aggregate([
      {
        $group: {
          _id: null,
          totalSize: { $sum: "$fileSize" }
        }
      }
    ]);
    
    const totalSizeMB = totalSize.length > 0 ? (totalSize[0].totalSize / 1024 / 1024).toFixed(2) : 0;
    
    res.json({
      database: 'MongoDB Atlas',
      storage: 'Permanent',
      pdfCount: pdfCount,
      totalStorage: `${totalSizeMB} MB`,
      serverRestart: 'Data survives restarts',
      status: 'Active'
    });
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
  console.log('🚀 STUDY PORTAL - MONGODB ATLAS PERMANENT STORAGE');
  console.log('='.repeat(60));
  console.log(`✅ Server running on port: ${PORT}`);
  console.log(`🌐 App URL: https://exam-k35t.onrender.com`);
  console.log(`💾 Database: MongoDB Atlas (Permanent)`);
  console.log(`📄 PDF Storage: Files stored in MongoDB`);
  console.log(`🔄 Server Restart: Data persists automatically`);
  console.log('='.repeat(60));
  console.log('✅ Your data is now permanently stored in MongoDB Atlas!');
  console.log('✅ PDFs will survive server restarts!');
  console.log('='.repeat(60));
});
