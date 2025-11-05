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

mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('✅ Connected to MongoDB Atlas successfully');
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
  fileBuffer: { type: Buffer }, // Store PDF file content
  fileSize: { type: Number, default: 0 },
  uploadDate: { type: Date, default: Date.now }
});

const PDF = mongoose.model('PDF', pdfSchema);

// Multer configuration - Store files in memory
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
      pdfCount: pdfCount
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
      fileSize: pdf.fileSize,
      uploadDate: pdf.uploadDate,
      hasFile: !!pdf.fileBuffer // Check if file content exists
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
      fileSize: pdf.fileSize,
      uploadDate: pdf.uploadDate,
      hasFile: !!pdf.fileBuffer
    }));
    
    res.json(pdfList);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// ✅ SERVE PDF FILE - FIXED VERSION
app.get('/api/pdf/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    // Check if fileBuffer exists
    if (!pdf.fileBuffer) {
      console.log(`❌ PDF file content missing for: ${pdf.displayName}`);
      return res.status(404).json({ 
        error: 'PDF file content not available. Please re-upload the PDF.' 
      });
    }

    // Set proper headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.name}"`);
    
    // Send the PDF buffer
    res.send(pdf.fileBuffer);
    
    console.log(`📄 Served PDF: ${pdf.displayName} (${pdf.fileSize} bytes)`);
  } catch (error) {
    console.error('Error serving PDF:', error);
    res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

// ✅ DOWNLOAD PDF - FIXED VERSION
app.get('/api/download-pdf/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    if (!pdf.fileBuffer) {
      return res.status(404).json({ 
        error: 'PDF file content not available for download' 
      });
    }

    // Set download headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.name}"`);
    
    // Send the PDF buffer for download
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

// ✅ UPLOAD PDF - STORES FILE CONTENT IN MONGODB
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
      path: `/api/pdf/`, // Will update with ID
      type: pdfType,
      icon: pdfIcon,
      color: pdfColor || '#6a11cb',
      fileBuffer: req.file.buffer, // Store the actual file content
      fileSize: req.file.size
    });

    const savedPdf = await newPdf.save();
    
    // Update path with actual ID
    savedPdf.path = `/api/pdf/${savedPdf._id}`;
    await savedPdf.save();

    console.log(`✅ PDF stored in MongoDB: "${savedPdf.displayName}"`);
    console.log(`💾 File size: ${(savedPdf.fileSize / 1024 / 1024).toFixed(2)} MB`);

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

// ✅ FIX: Re-upload missing PDF files
app.post('/api/admin/reupload-pdf/:id', upload.single('pdfFile'), async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Update PDF with new file buffer
    pdf.fileBuffer = req.file.buffer;
    pdf.fileSize = req.file.size;
    await pdf.save();

    console.log(`✅ Re-uploaded PDF content: ${pdf.displayName}`);
    
    res.json({ 
      success: true, 
      message: 'PDF file content updated successfully' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check PDF status
app.get('/api/pdf-status/:id', async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    res.json({
      _id: pdf._id,
      displayName: pdf.displayName,
      hasFileBuffer: !!pdf.fileBuffer,
      fileSize: pdf.fileSize,
      status: pdf.fileBuffer ? 'Complete' : 'Missing File Content'
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
  console.log('🚀 STUDY PORTAL - MONGODB COMPLETE SOLUTION');
  console.log('='.repeat(50));
  console.log(`✅ Server running on port: ${PORT}`);
  console.log(`📄 PDF files stored in MongoDB Atlas`);
  console.log(`💾 Permanent storage - survives server restarts`);
  console.log('='.repeat(50));
});
