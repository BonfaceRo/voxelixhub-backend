import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const stock = await prisma.stock.findMany({
      where: { tenantId: req.user!.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ stock });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, price, category, condition, status, quantity } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const item = await prisma.stock.create({
      data: {
        tenantId:    req.user!.tenantId,
        name,
        description: description || null,
        price:       price       ? parseFloat(price) : null,
        category:    category    || null,
        condition:   condition   || 'NEW',
        status:      status      || 'AVAILABLE',
        quantity:    quantity    ? parseInt(quantity) : 1,
      },
    });
    res.status(201).json({ message: 'Stock item created', item });
  } catch (error) {
    console.error('POST /stock error:', error);
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.stock.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
    });
    if (!existing) return res.status(404).json({ error: 'Item not found' });
    const item = await prisma.stock.update({
      where: { id: req.params.id },
      data: {
        name:        req.body.name        || existing.name,
        description: req.body.description ?? existing.description,
        price:       req.body.price       ? parseFloat(req.body.price) : existing.price,
        category:    req.body.category    ?? existing.category,
        condition:   req.body.condition   || existing.condition,
        status:      req.body.status      || existing.status,
        quantity:    req.body.quantity    ? parseInt(req.body.quantity) : existing.quantity,
      },
    });
    res.json({ message: 'Stock item updated', item });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.patch('/:id/sold', async (req, res) => {
  try {
    const existing = await prisma.stock.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
    });
    if (!existing) return res.status(404).json({ error: 'Item not found' });
    const item = await prisma.stock.update({
      where: { id: req.params.id },
      data:  { status: 'SOLD' },
    });
    res.json({ message: 'Item marked as sold', item });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.stock.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenantId },
    });
    if (!existing) return res.status(404).json({ error: 'Item not found' });
    await prisma.stock.delete({ where: { id: req.params.id } });
    res.json({ message: 'Stock item deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.get('/available', async (req, res) => {
  try {
    const stock = await prisma.stock.findMany({
      where: { tenantId: req.user!.tenantId, status: 'AVAILABLE' },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ stock });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

export default router;
