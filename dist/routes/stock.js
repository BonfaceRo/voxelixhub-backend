"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
router.use(auth_1.authMiddleware);
// ── Get all stock ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const stock = await prisma.stock.findMany({
            where: { tenantId: req.user.tenantId },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ stock });
    }
    catch (error) {
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── Create stock item ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { name, description, price, category, condition, status, quantity } = req.body;
        if (!name)
            return res.status(400).json({ error: 'Name is required' });
        const item = await prisma.stock.create({
            data: {
                tenantId: req.user.tenantId,
                name,
                description: description || null,
                price: price ? parseFloat(price) : null,
                category: category || null,
                condition: condition || 'NEW',
                status: status || 'AVAILABLE',
                quantity: quantity || 1,
            },
        });
        res.status(201).json({ message: 'Stock item created', item });
    }
    catch (error) {
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── Update stock item ─────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const existing = await prisma.stock.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing)
            return res.status(404).json({ error: 'Item not found' });
        const item = await prisma.stock.update({
            where: { id: req.params.id },
            data: {
                name: req.body.name || existing.name,
                description: req.body.description ?? existing.description,
                price: req.body.price ? parseFloat(req.body.price) : existing.price,
                category: req.body.category ?? existing.category,
                condition: req.body.condition || existing.condition,
                status: req.body.status || existing.status,
                quantity: req.body.quantity ?? existing.quantity,
            },
        });
        res.json({ message: 'Stock item updated', item });
    }
    catch (error) {
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── Mark as sold ──────────────────────────────────────────────────────────────
router.patch('/:id/sold', async (req, res) => {
    try {
        const existing = await prisma.stock.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing)
            return res.status(404).json({ error: 'Item not found' });
        const item = await prisma.stock.update({
            where: { id: req.params.id },
            data: { status: 'SOLD' },
        });
        res.json({ message: 'Item marked as sold', item });
    }
    catch (error) {
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── Delete stock item ─────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const existing = await prisma.stock.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing)
            return res.status(404).json({ error: 'Item not found' });
        await prisma.stock.delete({ where: { id: req.params.id } });
        res.json({ message: 'Stock item deleted' });
    }
    catch (error) {
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── Get available stock for AI ────────────────────────────────────────────────
router.get('/available', async (req, res) => {
    try {
        const stock = await prisma.stock.findMany({
            where: {
                tenantId: req.user.tenantId,
                status: 'AVAILABLE',
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ stock });
    }
    catch (error) {
        res.status(500).json({ error: 'Something went wrong' });
    }
});
exports.default = router;
//# sourceMappingURL=stock.js.map