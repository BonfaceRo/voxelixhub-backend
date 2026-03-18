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
// All leads routes require authentication
router.use(auth_1.authMiddleware);
// ── Get all leads ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { status, source, search, page = '1', limit = '20' } = req.query;
        const tenantId = req.user.tenantId;
        const where = { tenantId };
        if (status)
            where.status = status;
        if (source)
            where.source = source;
        if (search) {
            where.OR = [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
            ];
        }
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [leads, total] = await Promise.all([
            prisma.lead.findMany({
                where,
                include: {
                    assignedTo: {
                        select: { id: true, firstName: true, lastName: true },
                    },
                    messages: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit),
            }),
            prisma.lead.count({ where }),
        ]);
        res.json({
            leads,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    }
    catch (error) {
        console.error('Get leads error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── Get single lead ───────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const lead = await prisma.lead.findFirst({
            where: {
                id: req.params.id,
                tenantId: req.user.tenantId,
            },
            include: {
                assignedTo: {
                    select: { id: true, firstName: true, lastName: true },
                },
                messages: {
                    orderBy: { createdAt: 'asc' },
                },
            },
        });
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        res.json({ lead });
    }
    catch (error) {
        console.error('Get lead error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── Create lead ───────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { firstName, lastName, email, phone, source, status, notes, assignedToId, } = req.body;
        if (!firstName) {
            return res.status(400).json({ error: 'First name is required' });
        }
        const lead = await prisma.lead.create({
            data: {
                tenantId: req.user.tenantId,
                firstName,
                lastName: lastName || null,
                email: email || null,
                phone: phone || null,
                source: source || 'MANUAL',
                status: status || 'NEW',
                notes: notes || null,
                assignedToId: assignedToId || null,
                score: 0,
            },
        });
        res.status(201).json({ message: 'Lead created', lead });
    }
    catch (error) {
        console.error('Create lead error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── Update lead ───────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const existing = await prisma.lead.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        const lead = await prisma.lead.update({
            where: { id: req.params.id },
            data: {
                firstName: req.body.firstName || existing.firstName,
                lastName: req.body.lastName ?? existing.lastName,
                email: req.body.email ?? existing.email,
                phone: req.body.phone ?? existing.phone,
                source: req.body.source || existing.source,
                status: req.body.status || existing.status,
                notes: req.body.notes ?? existing.notes,
                score: req.body.score ?? existing.score,
                assignedToId: req.body.assignedToId ?? existing.assignedToId,
            },
        });
        res.json({ message: 'Lead updated', lead });
    }
    catch (error) {
        console.error('Update lead error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── Delete lead ───────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const existing = await prisma.lead.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        await prisma.lead.delete({ where: { id: req.params.id } });
        res.json({ message: 'Lead deleted' });
    }
    catch (error) {
        console.error('Delete lead error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── Get lead stats ────────────────────────────────────────────────────────────
router.get('/stats/summary', async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const [total, newLeads, hot, converted] = await Promise.all([
            prisma.lead.count({ where: { tenantId } }),
            prisma.lead.count({ where: { tenantId, status: 'NEW' } }),
            prisma.lead.count({ where: { tenantId, status: 'HOT' } }),
            prisma.lead.count({ where: { tenantId, status: 'CONVERTED' } }),
        ]);
        res.json({
            stats: { total, new: newLeads, hot, converted },
        });
    }
    catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});
exports.default = router;
//# sourceMappingURL=leads.js.map