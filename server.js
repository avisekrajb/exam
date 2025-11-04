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
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Atlas Connection
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in environment variables');
  console.log('💡 Please set MONGODB_URI in Render environment variables');
  process.exit(1);
}

console.log('🔗 Attempting MongoDB connection...');

// MongoDB connection with Render optimization
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000, // 30 seconds
  socketTimeoutMS: 45000, // 45 seconds
  bufferCommands: false,
  maxPoolSize: 10,
})
.then(() => {
  console.log('✅ Connected to MongoDB Atlas successfully');
  console.log('📊 Database:', mongoose.connection.name);
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  console.log('💡 Please check:');
  console.log('1. Network Access in MongoDB Atlas - Add 0.0.0.0/0');
  console.log('2. Database user credentials are correct');
  console.log('3. Connection string format is valid');
});

// MongoDB connection events
mongoose.connection.on('connected', () => {
  console.log('🎉 MongoDB connected - App is ready!');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected');
});

// MongoDB Schemas
const pdfSchema = new mongoose.Schema({
  name: { type: String, required: true },
  displayName: { type: String, required: true },
  filename: { type: String, required: true },
  path: { type: String, required: true },
  type: { type: String, required: true, enum: ['material', 'imp-material'] },
  icon: { type: String, required: true },
  color: { type: String, default: '#6a11cb' },
  dateAdded: { type: Date, default: Date.now }
});

const visitSchema = new mongoose.Schema({
  count: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now }
});

const PDF = mongoose.model('PDF', pdfSchema);
const Visit = mongoose.model('Visit', visitSchema);

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const originalName = path.parse(file.originalname).name;
    const uniqueName = originalName + '-' + Date.now() + '.pdf';
    cb(null, uniqueName);
  }
});

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
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  
  try {
    if (dbStatus === 'connected') {
      const materialCount = await PDF.countDocuments({ type: 'material' });
      const impMaterialCount = await PDF.countDocuments({ type: 'imp-material' });
      const totalPdfCount = await PDF.countDocuments();
      const visitData = await Visit.findOne();
      
      res.json({
        status: 'OK',
        deployment: 'Render',
        database: dbStatus,
        pdfs: {
          materials: materialCount,
          important: impMaterialCount,
          total: totalPdfCount
        },
        totalVisits: visitData ? visitData.count : 0,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({
        status: 'ERROR',
        database: 'disconnected',
        message: 'MongoDB not connected. Check network access in Atlas.',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.json({
      status: 'ERROR',
      database: dbStatus,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get all PDFs
app.get('/api/pdfs', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(500).json({ error: 'Database not connected' });
  }
  
  try {
    const pdfs = await PDF.find().sort({ dateAdded: -1 });
    console.log(`📚 Serving ${pdfs.length} PDFs`);
    res.json(pdfs);
  } catch (error) {
    console.error('Error fetching PDFs:', error);
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// Get PDFs by type
app.get('/api/pdfs/:type', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(500).json({ error: 'Database not connected' });
  }
  
  try {
    const pdfs = await PDF.find({ type: req.params.type }).sort({ dateAdded: -1 });
    res.json(pdfs);
  } catch (error) {
    console.error('Error fetching PDFs by type:', error);
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// Get PDF counts
app.get('/api/stats/counts', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(500).json({ error: 'Database not connected' });
  }
  
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
    console.error('Error getting counts:', error);
    res.status(500).json({ error: 'Failed to get counts' });
  }
});

// Serve PDF files
app.get('/uploads/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'public', 'uploads', filename);
    
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'PDF file not found' });
    }
  } catch (error) {
    console.error('Error serving PDF file:', error);
    res.status(500).json({ error: 'Failed to serve PDF file' });
  }
});

// Admin: Add new PDF
app.post('/api/admin/pdfs', upload.single('pdfFile'), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(500).json({ error: 'Database not connected' });
  }
  
  try {
    console.log('📤 Admin uploading PDF...');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const { displayName, type, icon, color } = req.body;
    
    // Validate required fields
    if (!displayName || !type || !icon) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Missing required fields: displayName, type, icon' });
    }

    const newPdf = new PDF({
      name: req.file.originalname,
      displayName: displayName,
      filename: req.file.filename,
      path: `/uploads/${req.file.filename}`,
      type: type,
      icon: icon,
      color: color || '#6a11cb'
    });
    
    const savedPdf = await newPdf.save();
    console.log(`✅ PDF added: "${savedPdf.displayName}"`);
    
    res.status(201).json({
      success: true,
      message: 'PDF added successfully',
      pdf: savedPdf
    });
    
  } catch (error) {
    console.error('❌ Error adding PDF:', error);
    
    // Delete uploaded file if there was an error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to add PDF: ' + error.message 
    });
  }
});

// Admin: Delete PDF
app.delete('/api/admin/pdfs/:id', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(500).json({ error: 'Database not connected' });
  }
  
  try {
    const pdf = await PDF.findById(req.params.id);
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    // Delete the file from the server
    const filePath = path.join(__dirname, 'public', pdf.path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Deleted file: ${pdf.filename}`);
    }

    await PDF.findByIdAndDelete(req.params.id);
    console.log(`✅ PDF deleted: "${pdf.displayName}"`);
    
    res.json({ 
      success: true,
      message: 'PDF deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting PDF:', error);
    res.status(500).json({ error: 'Failed to delete PDF' });
  }
});

// Visit tracking
app.get('/api/visits', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(500).json({ error: 'Database not connected' });
  }
  
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
  if (mongoose.connection.readyState !== 1) {
    return res.status(500).json({ error: 'Database not connected' });
  }
  
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

// Initialize sample data
app.post('/api/init-sample', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(500).json({ error: 'Database not connected' });
  }
  
  try {
    const samplePDFs = [
      {
        name: "bct.pdf",
        displayName: "Basic Computer Technology",
        filename: "sample-bct.pdf",
        path: "/uploads/sample-bct.pdf",
        type: "material",
        icon: "fa-laptop-code",
        color: "#6a11cb"
      },
      {
        name: "cloud-computing.pdf",
        displayName: "Cloud Computing Fundamentals", 
        filename: "sample-cc.pdf",
        path: "/uploads/sample-cc.pdf",
        type: "material",
        icon: "fa-cloud",
        color: "#1abc9c"
      }
    ];

    // Clear existing and insert sample data
    await PDF.deleteMany({});
    const result = await PDF.insertMany(samplePDFs);
    
    res.json({
      success: true,
      message: `Added ${result.length} sample PDFs`,
      pdfs: result
    });
  } catch (error) {
    console.error('Error initializing sample data:', error);
    res.status(500).json({ error: 'Failed to initialize sample data' });
  }
});

// ==================== CLIENT ROUTING ====================

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ERROR HANDLING ====================

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// ==================== SERVER START ====================

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🚀 STUDY MATERIALS PORTAL - RENDER DEPLOYMENT');
  console.log('='.repeat(60));
  console.log(`✅ Server running on port: ${PORT}`);
  console.log(`🌐 App URL: https://exam-k35t.onrender.com`);
  console.log(`🔍 Health check: /api/health`);
  console.log(`📊 API Status: /api/stats/counts`);
  console.log(`📚 PDF API: /api/pdfs`);
  console.log('='.repeat(60));
  console.log('🔄 Waiting for MongoDB connection...');
  console.log('💡 If connection fails, check Network Access in MongoDB Atlas');
  console.log('💡 Add 0.0.0.0/0 to allow Render IP addresses');
  console.log('='.repeat(60));
});

// Graceful shutdown for Render
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await mongoose.connection.close();
  console.log('✅ MongoDB connection closed.');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Render shutdown signal received...');
  await mongoose.connection.close();
  console.log('✅ MongoDB connection closed.');
  process.exit(0);
});
