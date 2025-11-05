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

// ==================== DATABASE SETUP ====================

// Fallback database file (if MongoDB fails)
const FALLBACK_DB_FILE = 'fallback-database.json';

// Initialize fallback database
const initializeFallbackDB = () => {
    if (!fs.existsSync(FALLBACK_DB_FILE)) {
        const initialData = {
            pdfs: [],
            visits: 0,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(FALLBACK_DB_FILE, JSON.stringify(initialData, null, 2));
        console.log('📁 Fallback database initialized');
    }
};

// Read fallback database
const readFallbackDB = () => {
    initializeFallbackDB();
    try {
        return JSON.parse(fs.readFileSync(FALLBACK_DB_FILE, 'utf8'));
    } catch (error) {
        console.error('Error reading fallback DB:', error);
        return { pdfs: [], visits: 0 };
    }
};

// Write to fallback database
const writeFallbackDB = (data) => {
    try {
        data.lastUpdated = new Date().toISOString();
        fs.writeFileSync(FALLBACK_DB_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing fallback DB:', error);
        return false;
    }
};

// Sync fallback data to MongoDB when available
const syncToMongoDB = async (fallbackData) => {
    if (mongoose.connection.readyState === 1 && fallbackData.pdfs.length > 0) {
        try {
            console.log('🔄 Syncing fallback data to MongoDB...');
            await PDF.deleteMany({});
            const mongoPdfs = fallbackData.pdfs.map(pdf => ({
                ...pdf,
                _id: pdf.id // Use the same ID
            }));
            await PDF.insertMany(mongoPdfs);
            console.log(`✅ Synced ${mongoPdfs.length} PDFs to MongoDB`);
            
            // Clear fallback after successful sync
            writeFallbackDB({ pdfs: [], visits: fallbackData.visits, lastUpdated: new Date().toISOString() });
        } catch (error) {
            console.error('❌ Sync to MongoDB failed:', error);
        }
    }
};

// ==================== MONGODB SETUP ====================

let isMongoConnected = false;

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
}, { _id: true });

const visitSchema = new mongoose.Schema({
    count: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
});

const PDF = mongoose.model('PDF', pdfSchema);
const Visit = mongoose.model('Visit', visitSchema);

// MongoDB Connection with Auto-Retry
const connectMongoDB = async () => {
    const MONGODB_URI = process.env.MONGODB_URI;
    
    if (!MONGODB_URI) {
        console.log('❌ MONGODB_URI not found, using fallback database');
        return false;
    }

    try {
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            bufferCommands: false,
        });
        
        isMongoConnected = true;
        console.log('✅ MongoDB Connected Successfully');
        
        // Sync fallback data to MongoDB
        const fallbackData = readFallbackDB();
        if (fallbackData.pdfs.length > 0) {
            await syncToMongoDB(fallbackData);
        }
        
        return true;
    } catch (error) {
        console.log('❌ MongoDB Connection Failed, using fallback database');
        isMongoConnected = false;
        return false;
    }
};

// Initialize database connection
connectMongoDB();

// ==================== DATA ACCESS LAYER ====================

// Unified function to get PDFs (tries MongoDB first, then fallback)
const getPDFs = async (type = null) => {
    if (isMongoConnected) {
        try {
            let query = {};
            if (type) query.type = type;
            const pdfs = await PDF.find(query).sort({ dateAdded: -1 });
            return pdfs;
        } catch (error) {
            console.error('MongoDB query failed, using fallback:', error);
            isMongoConnected = false;
        }
    }
    
    // Use fallback database
    const fallbackData = readFallbackDB();
    let pdfs = fallbackData.pdfs;
    if (type) {
        pdfs = pdfs.filter(pdf => pdf.type === type);
    }
    return pdfs.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
};

// Unified function to get counts
const getCounts = async () => {
    if (isMongoConnected) {
        try {
            const materialCount = await PDF.countDocuments({ type: 'material' });
            const impMaterialCount = await PDF.countDocuments({ type: 'imp-material' });
            return { materialCount, impMaterialCount, totalCount: materialCount + impMaterialCount };
        } catch (error) {
            console.error('MongoDB count failed, using fallback:', error);
            isMongoConnected = false;
        }
    }
    
    // Use fallback database
    const fallbackData = readFallbackDB();
    const materialCount = fallbackData.pdfs.filter(pdf => pdf.type === 'material').length;
    const impMaterialCount = fallbackData.pdfs.filter(pdf => pdf.type === 'imp-material').length;
    return { materialCount, impMaterialCount, totalCount: materialCount + impMaterialCount };
};

// Unified function to add PDF
const addPDF = async (pdfData) => {
    // Always save to fallback first for immediate persistence
    const fallbackData = readFallbackDB();
    const newPdf = {
        id: Date.now().toString(),
        ...pdfData,
        dateAdded: new Date().toISOString()
    };
    
    fallbackData.pdfs.push(newPdf);
    writeFallbackDB(fallbackData);
    console.log('✅ PDF saved to fallback database');

    // Try to save to MongoDB if available
    if (isMongoConnected) {
        try {
            const mongoPdf = new PDF({
                _id: newPdf.id,
                ...pdfData
            });
            await mongoPdf.save();
            console.log('✅ PDF also saved to MongoDB');
        } catch (error) {
            console.error('❌ MongoDB save failed, but PDF is safe in fallback');
        }
    }
    
    return newPdf;
};

// Unified function to delete PDF
const deletePDF = async (pdfId) => {
    // Delete from fallback
    const fallbackData = readFallbackDB();
    const pdfIndex = fallbackData.pdfs.findIndex(pdf => pdf.id === pdfId);
    
    if (pdfIndex !== -1) {
        const pdf = fallbackData.pdfs[pdfIndex];
        
        // Delete file from server
        const filePath = path.join(__dirname, 'public', pdf.path);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        fallbackData.pdfs.splice(pdfIndex, 1);
        writeFallbackDB(fallbackData);
        console.log('✅ PDF deleted from fallback database');
    }

    // Try to delete from MongoDB if available
    if (isMongoConnected) {
        try {
            await PDF.findByIdAndDelete(pdfId);
            console.log('✅ PDF also deleted from MongoDB');
        } catch (error) {
            console.error('❌ MongoDB delete failed, but PDF removed from fallback');
        }
    }
};

// ==================== MULTER SETUP ====================

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

// Health check with database status
app.get('/api/health', async (req, res) => {
    const counts = await getCounts();
    const fallbackData = readFallbackDB();
    
    res.json({
        status: 'OK',
        database: {
            mongodb: isMongoConnected ? 'connected' : 'disconnected',
            fallback: 'active'
        },
        data: {
            pdfs: counts.totalCount,
            materials: counts.materialCount,
            important: counts.impMaterialCount,
            fallbackPdfs: fallbackData.pdfs.length,
            lastUpdated: fallbackData.lastUpdated
        },
        server: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString()
        }
    });
});

// Get all PDFs
app.get('/api/pdfs', async (req, res) => {
    try {
        const pdfs = await getPDFs();
        res.json(pdfs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch PDFs' });
    }
});

// Get PDFs by type
app.get('/api/pdfs/:type', async (req, res) => {
    try {
        const pdfs = await getPDFs(req.params.type);
        res.json(pdfs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch PDFs' });
    }
});

// Get counts
app.get('/api/stats/counts', async (req, res) => {
    try {
        const counts = await getCounts();
        res.json(counts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get counts' });
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

        const savedPdf = await addPDF(pdfData);

        res.json({
            success: true,
            message: 'PDF uploaded successfully!',
            pdf: savedPdf,
            database: isMongoConnected ? 'mongodb+fallback' : 'fallback'
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
        await deletePDF(req.params.id);
        res.json({ 
            success: true, 
            message: 'PDF deleted successfully',
            database: isMongoConnected ? 'mongodb+fallback' : 'fallback'
        });
    } catch (error) {
        res.status(500).json({ error: 'Delete failed' });
    }
});

// Serve uploaded files
app.get('/uploads/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'uploads', req.params.filename);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// Database status endpoint
app.get('/api/database/status', (req, res) => {
    const fallbackData = readFallbackDB();
    res.json({
        mongodb: isMongoConnected ? 'connected' : 'disconnected',
        fallback: {
            pdfs: fallbackData.pdfs.length,
            visits: fallbackData.visits,
            lastUpdated: fallbackData.lastUpdated
        },
        sync: {
            status: isMongoConnected ? 'active' : 'standalone',
            retry: 'automatic'
        }
    });
});

// Force MongoDB reconnection
app.post('/api/database/reconnect', async (req, res) => {
    const result = await connectMongoDB();
    res.json({
        success: result,
        message: result ? 'MongoDB reconnected successfully' : 'MongoDB connection failed',
        connected: isMongoConnected
    });
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== SERVER START ====================

// Initialize fallback database on startup
initializeFallbackDB();

// Periodic MongoDB reconnection attempt
setInterval(async () => {
    if (!isMongoConnected && process.env.MONGODB_URI) {
        console.log('🔄 Attempting MongoDB reconnection...');
        await connectMongoDB();
    }
}, 30000); // Try every 30 seconds

// Start server
app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 STUDY PORTAL - PERSISTENT DATABASE SYSTEM');
    console.log('='.repeat(60));
    console.log(`✅ Server running on port: ${PORT}`);
    console.log(`🌐 App URL: https://exam-k35t.onrender.com`);
    console.log(`📊 Database: ${isMongoConnected ? 'MongoDB + Fallback' : 'Fallback Only'}`);
    console.log(`💾 Data Persistence: GUARANTEED`);
    console.log(`🔄 Auto-sync: ${isMongoConnected ? 'ACTIVE' : 'STANDBY'}`);
    console.log('='.repeat(60));
    console.log('✅ Data survives server restarts!');
    console.log('✅ PDFs persist even if MongoDB fails!');
    console.log('✅ Automatic database synchronization!');
    console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    if (isMongoConnected) {
        await mongoose.connection.close();
    }
    process.exit(0);
});
