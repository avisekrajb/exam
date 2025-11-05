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
  console.error('❌ MONGODB_URI is not defined');
  process.exit(1);
}

console.log('🔗 Connecting to MongoDB...');

// MongoDB connection
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
})
.then(() => {
  console.log('✅ MongoDB Connected Successfully');
})
.catch(err => {
  console.error('❌ MongoDB Connection Failed:', err.message);
});

// MongoDB Schemas
const pdfSchema = new mongoose.Schema({
  name: String,
  displayName: String,
  filename: String,
  path: String,
  type: String,
  icon: String,
  color: { type: String, default: '#6a11cb' },
  dateAdded: { type: Date, default: Date.now }
});

const PDF = mongoose.model('PDF', pdfSchema);

// Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + Math.random().toString(36).substring(7) + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ==================== ROUTES ====================

// Health check
app.get('/api/health', async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({ status: 'OK', database: dbStatus });
});

// Get all PDFs
app.get('/api/pdfs', async (req, res) => {
  try {
    const pdfs = await PDF.find().sort({ dateAdded: -1 });
    res.json(pdfs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// Get PDFs by type
app.get('/api/pdfs/:type', async (req, res) => {
  try {
    const pdfs = await PDF.find({ type: req.params.type }).sort({ dateAdded: -1 });
    res.json(pdfs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// Get counts
app.get('/api/stats/counts', async (req, res) => {
  try {
    const materialCount = await PDF.countDocuments({ type: 'material' });
    const impMaterialCount = await PDF.countDocuments({ type: 'imp-material' });
    res.json({ materialCount, impMaterialCount, totalCount: materialCount + impMaterialCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get counts' });
  }
});

// ✅ FIXED: Serve PDF files properly
app.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'public', 'uploads', filename);
  
  console.log('📄 Serving PDF file:', filename);
  console.log('📁 File path:', filePath);
  
  if (fs.existsSync(filePath)) {
    // Set proper headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filePath);
  } else {
    console.log('❌ PDF file not found:', filePath);
    res.status(404).json({ error: 'PDF file not found' });
  }
});

// Admin: Add PDF
app.post('/api/admin/pdfs', upload.single('pdfFile'), async (req, res) => {
  try {
    console.log('📤 PDF Upload Request Received');
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { pdfName, pdfDisplayName, pdfType, pdfIcon, pdfColor } = req.body;

    if (!pdfDisplayName || !pdfType || !pdfIcon) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    const pdfData = {
      name: pdfName || req.file.originalname,
      displayName: pdfDisplayName,
      filename: req.file.filename,
      path: `/uploads/${req.file.filename}`,
      type: pdfType,
      icon: pdfIcon,
      color: pdfColor || '#6a11cb'
    };

    const newPdf = new PDF(pdfData);
    const savedPdf = await newPdf.save();

    console.log('✅ PDF saved to MongoDB:', savedPdf.filename);

    res.json({
      success: true,
      message: 'PDF uploaded successfully!',
      pdf: savedPdf
    });

  } catch (error) {
    console.error('❌ PDF Upload Error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ 
      success: false, 
      error: 'Upload failed' 
    });
  }
});

// Admin: Delete PDF
app.delete('/api/admin/pdfs/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    // Delete file from server
    const filePath = path.join(__dirname, 'public', pdf.path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('🗑️ Deleted file:', pdf.filename);
    }

    await PDF.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'PDF deleted successfully' });

  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ✅ FIXED: Serve frontend only for specific routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve frontend for other page routes (but not file routes)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/viewer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🚀 STUDY PORTAL - PDF FIXED VERSION');
  console.log('='.repeat(50));
  console.log(`✅ Server running on port: ${PORT}`);
  console.log(`🌐 App URL: https://exam-k35t.onrender.com`);
  console.log(`📄 PDF files will open properly now!`);
  console.log('='.repeat(50));
});
