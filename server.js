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

// Updated MongoDB connection (removed deprecated options)
mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('✅ Connected to MongoDB Atlas successfully');
  console.log('💾 Database: Permanent storage enabled');
})
.catch(err => {
  console.error('❌ MongoDB connection failed:', err.message);
  process.exit(1);
});

// MongoDB Schemas
const pdfSchema = new mongoose.Schema({
  name: { type: String, required: true },
  displayName: { type: String, required: true },
  filename: { type: String, required: true },
  path: { type: String, required: true },
  type: { type: String, required: true },
  icon: { type: String, required: true },
  color: { type: String, default: '#6a11cb' },
  fileBuffer: { type: Buffer }, // Make optional for existing PDFs
  fileSize: { type: Number, default: 0 }, // Add default value
  uploadDate: { type: Date, default: Date.now }
});

const visitSchema = new mongoose.Schema({
  count: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now }
});

const PDF = mongoose.model('PDF', pdfSchema);
const Visit = mongoose.model('Visit', visitSchema);

// Multer configuration
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ==================== ROUTES ====================

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const pdfCount = await PDF.countDocuments();
    
    res.json({
      status: 'OK',
      database: dbStatus,
      pdfCount: pdfCount,
      storage: 'MongoDB Atlas - Permanent'
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
    
    const pdfList = pdfs.map(pdf => ({
      _id: pdf._id,
      name: pdf.name,
      displayName: pdf.displayName,
      filename: pdf.filename,
      path: `/api/pdf/${pdf._id}`,
      type: pdf.type,
      icon: pdf.icon,
      color: pdf.color,
      fileSize: pdf.fileSize || 0,
      uploadDate: pdf.uploadDate
    }));
    
    res.json(pdfList);
  } catch (error) {
    console.error('Error fetching PDFs:', error);
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// Get PDFs by type
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
      fileSize: pdf.fileSize || 0,
      uploadDate: pdf.uploadDate
    }));
    
    res.json(pdfList);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// ✅ FIXED: Serve PDF file from MongoDB with error handling
app.get('/api/pdf/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    // Check if fileBuffer exists
    if (!pdf.fileBuffer) {
      return res.status(404).json({ error: 'PDF file not available in database' });
    }

    // Set headers with safe values
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.name}"`);
    
    // Only set Content-Length if fileSize exists and is valid
    if (pdf.fileSize && pdf.fileSize > 0) {
      res.setHeader('Content-Length', pdf.fileSize);
    }
    
    // Send the PDF buffer
    res.send(pdf.fileBuffer);
    
    console.log(`📄 Served PDF: ${pdf.displayName}`);
  } catch (error) {
    console.error('Error serving PDF:', error);
    res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

// ✅ FIXED: Download PDF from MongoDB
app.get('/api/download-pdf/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    if (!pdf.fileBuffer) {
      return res.status(404).json({ error: 'PDF file not available' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.name}"`);
    
    if (pdf.fileSize && pdf.fileSize > 0) {
      res.setHeader('Content-Length', pdf.fileSize);
    }
    
    res.send(pdf.fileBuffer);
    
    console.log(`📥 Downloaded: ${pdf.displayName}`);
  } catch (error) {
    res.status(500).json({ error: 'Failed to download PDF' });
  }
});

// Get counts
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

// ✅ FIXED: Upload PDF to MongoDB
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

    // Create PDF with file buffer
    const newPdf = new PDF({
      name: pdfName || req.file.originalname,
      displayName: pdfDisplayName,
      filename: req.file.originalname,
      path: `/api/pdf/`, // Will update with ID
      type: pdfType,
      icon: pdfIcon,
      color: pdfColor || '#6a11cb',
      fileBuffer: req.file.buffer,
      fileSize: req.file.size
    });

    const savedPdf = await newPdf.save();
    
    // Update path with actual ID
    savedPdf.path = `/api/pdf/${savedPdf._id}`;
    await savedPdf.save();

    console.log(`✅ PDF stored in MongoDB: "${savedPdf.displayName}"`);

    res.json({
      success: true,
      message: 'PDF stored permanently in MongoDB!',
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
    console.error('Upload error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Upload failed: ' + error.message 
    });
  }
});

// Delete PDF
app.delete('/api/admin/pdfs/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    await PDF.findByIdAndDelete(req.params.id);
    console.log(`🗑️ Deleted: "${pdf.displayName}"`);
    
    res.json({ success: true, message: 'PDF deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Fix existing PDFs (run once to fix old PDFs)
app.post('/api/fix-pdfs', async (req, res) => {
  try {
    const pdfs = await PDF.find({ fileSize: { $exists: false } });
    console.log(`🛠️ Fixing ${pdfs.length} PDFs with missing fileSize`);
    
    for (let pdf of pdfs) {
      if (pdf.fileBuffer) {
        pdf.fileSize = pdf.fileBuffer.length;
        await pdf.save();
        console.log(`✅ Fixed: ${pdf.displayName}`);
      }
    }
    
    res.json({ 
      success: true, 
      message: `Fixed ${pdfs.length} PDFs` 
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
  console.log('='.repeat(50));
  console.log('🚀 STUDY PORTAL - MONGODB FIXED VERSION');
  console.log('='.repeat(50));
  console.log(`✅ Server running on port: ${PORT}`);
  console.log(`📄 PDF errors fixed - Ready to serve files!`);
  console.log('='.repeat(50));
});
