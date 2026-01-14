import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '5173', 10);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()) || ['http://localhost:3000'];

// Middleware
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Allow iframe embedding from any origin
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// Store active projects in memory
const projects = new Map();

// Health check endpoint (pour wake-up Railway)
app.get('/health', (req, res) => {
  res.json({
    status: 'alive',
    uptime: process.uptime(),
    timestamp: Date.now(),
    activeProjects: projects.size
  });
});

// Load project files into Vite
app.post('/load-project', async (req, res) => {
  try {
    const { projectId, files } = req.body;

    if (!projectId || !files || !Array.isArray(files)) {
      return res.status(400).json({ error: 'Invalid request: projectId and files required' });
    }

    console.log(`[${projectId}] Loading ${files.length} files...`);

    // Create virtual file system for this project
    const projectPath = join(__dirname, 'projects', projectId);
    await fs.mkdir(projectPath, { recursive: true });

    // Write all files to disk (temporary, will optimize with virtual FS later)
    for (const file of files) {
      const filePath = join(projectPath, file.path);
      const fileDir = dirname(filePath);

      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(filePath, file.content, 'utf-8');
    }

    // Create Vite server for this project (simplified config for Railway)
    const vite = await createViteServer({
      root: projectPath,
      server: {
        middlewareMode: true,
        hmr: false, // Disable HMR for Railway (simpler)
        allowedHosts: true // Allow all hosts (Railway, etc.)
      },
      appType: 'custom',
      css: {
        // Skip postcss.config.js from project files
        postcss: {}
      },
      optimizeDeps: {
        include: ['react', 'react-dom'],
        esbuildOptions: {
          // Handle JSX
          loader: { '.js': 'jsx', '.ts': 'tsx' }
        }
      },
      logLevel: 'error'
    });

    // Store project
    projects.set(projectId, {
      vite,
      path: projectPath,
      files,
      createdAt: Date.now()
    });

    console.log(`[${projectId}] ✅ Project loaded successfully`);

    res.json({
      success: true,
      projectId,
      previewUrl: `/preview/${projectId}`
    });

  } catch (error) {
    console.error('Error loading project:', error);
    res.status(500).json({
      error: 'Failed to load project',
      details: error.message
    });
  }
});

// Update file (for HMR)
app.post('/update-file', async (req, res) => {
  try {
    const { projectId, path, content } = req.body;

    if (!projectId || !path || content === undefined) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const project = projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    console.log(`[${projectId}] Updating file: ${path}`);

    // Write updated file
    const filePath = join(project.path, path);
    await fs.writeFile(filePath, content, 'utf-8');

    // Trigger HMR
    const module = project.vite.moduleGraph.getModuleById(filePath);
    if (module) {
      project.vite.moduleGraph.invalidateModule(module);
      project.vite.ws.send({
        type: 'update',
        updates: [{
          type: 'js-update',
          path: filePath,
          acceptedPath: filePath,
          timestamp: Date.now()
        }]
      });
    }

    console.log(`[${projectId}] ✅ File updated with HMR`);

    res.json({ success: true });

  } catch (error) {
    console.error('Error updating file:', error);
    res.status(500).json({
      error: 'Failed to update file',
      details: error.message
    });
  }
});

// Serve preview with iframe-friendly headers
app.use('/preview/:projectId', async (req, res, next) => {
  const { projectId } = req.params;
  const project = projects.get(projectId);

  if (!project) {
    return res.status(404).send('Project not found');
  }

  // Force iframe-friendly headers BEFORE Vite handles it
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = function (name, value) {
    // Block any X-Frame-Options header
    if (name.toLowerCase() === 'x-frame-options') {
      return this;
    }
    return originalSetHeader(name, value);
  };

  // Set our headers
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  // Use Vite middleware to serve the project
  project.vite.middlewares(req, res, next);
});

// Cleanup old projects (every 30 minutes)
setInterval(() => {
  const now = Date.now();
  const MAX_AGE = 30 * 60 * 1000; // 30 minutes

  for (const [projectId, project] of projects.entries()) {
    if (now - project.createdAt > MAX_AGE) {
      console.log(`[${projectId}] Cleaning up old project...`);
      project.vite.close();
      projects.delete(projectId);

      // Delete files (optional, can keep for cache)
      fs.rm(project.path, { recursive: true, force: true }).catch(console.error);
    }
  }
}, 30 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Vite Preview Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing servers...');

  for (const [projectId, project] of projects.entries()) {
    await project.vite.close();
  }

  process.exit(0);
});
