import { Router, Request, Response } from 'express';
import { browseDirectory, validateProjectDirectory } from '../modules/fs-browse';

const router = Router();

router.get('/browse', (req: Request, res: Response) => {
  try {
    const inputPath = typeof req.query.path === 'string' ? req.query.path : undefined;
    res.json(browseDirectory(inputPath));
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
});

router.get('/validate', (req: Request, res: Response) => {
  const inputPath = typeof req.query.path === 'string' ? req.query.path : '';
  if (!inputPath.trim()) {
    res.status(400).json({ message: 'path is required' });
    return;
  }
  res.json(validateProjectDirectory(inputPath));
});

export default router;