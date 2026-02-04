const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());

// Configuración
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Multer para recibir archivos
const upload = multer({ 
  dest: '/tmp/uploads/',
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB máximo entrada
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'shifty-video-compressor' });
});

// Endpoint principal
app.post('/compress', upload.single('video'), async (req, res) => {
  const startTime = Date.now();
  
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  const inputPath = req.file.path;
  const outputPath = `/tmp/compressed-${Date.now()}.mp4`;
  const { bucket = 'videos', folder = 'interviews' } = req.body;

  console.log(`[Compress] Iniciando: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)}MB)`);

  try {
    // 1. Comprimir con FFmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-vf', 'scale=-2:480',      // 480p altura, ancho proporcional
          '-c:v', 'libx264',           // Codec H.264
          '-crf', '28',                // Calidad (23-28 es bueno, mayor = más compresión)
          '-preset', 'fast',           // Balance velocidad/compresión
          '-c:a', 'aac',               // Audio AAC
          '-b:a', '128k',              // Audio bitrate
          '-movflags', '+faststart',   // Optimizado para streaming
        ])
        .output(outputPath)
        .on('start', (cmd) => console.log('[FFmpeg] Comando:', cmd))
        .on('progress', (p) => console.log(`[FFmpeg] Progreso: ${p.percent?.toFixed(1)}%`))
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // 2. Verificar tamaño resultante
    const stats = fs.statSync(outputPath);
    const compressedSizeMB = stats.size / 1024 / 1024;
    console.log(`[Compress] Comprimido: ${compressedSizeMB.toFixed(2)}MB`);

    if (compressedSizeMB > 45) {
      throw new Error(`Video comprimido sigue siendo muy grande: ${compressedSizeMB.toFixed(2)}MB`);
    }

    // 3. Subir a Supabase Storage
    const fileName = `${folder}/${Date.now()}-${req.file.originalname.replace(/\.[^/.]+$/, '')}.mp4`;
    const fileBuffer = fs.readFileSync(outputPath);

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, fileBuffer, {
        contentType: 'video/mp4',
        upsert: false
      });

    if (error) throw error;

    // 4. Obtener URL pública
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    // 5. Limpiar archivos temporales
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Compress] Completado en ${duration}s`);

    res.json({
      success: true,
      originalSize: (req.file.size / 1024 / 1024).toFixed(2) + 'MB',
      compressedSize: compressedSizeMB.toFixed(2) + 'MB',
      compressionRatio: ((1 - stats.size / req.file.size) * 100).toFixed(1) + '%',
      url: urlData.publicUrl,
      path: fileName,
      processingTime: duration + 's'
    });

  } catch (error) {
    console.error('[Compress] Error:', error);
    
    // Limpiar archivos en caso de error
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Video compressor running on port ${PORT}`);
});
