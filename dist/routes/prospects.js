"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const twilio_1 = __importDefault(require("twilio"));
const resend_1 = require("resend");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
const groq = new groq_sdk_1.default({ apiKey: process.env.GROQ_API_KEY });
function getTwilio() { return (0, twilio_1.default)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN); }
function getResend() { return new resend_1.Resend(process.env.RESEND_API_KEY); }
router.use(auth_1.authMiddleware);
// ── Upload prospects from CSV data ────────────────────────────────────────────
router.post('/upload', async (req, res) => {
    try {
        const { prospects } = req.body;
        if (!prospects || prospects.length === 0)
            return res.status(400).json({ error: 'No prospects provided' });
        const created = await prisma.prospect.createMany({
            data: prospects.map((p) => ({
                tenantId: req.user.tenantId,
                firstName: p.firstName || p.first_name || p.name?.split(' ')[0] || 'Friend',
                lastName: p.lastName || p.last_name || p.name?.split(' ')[1] || null,
                phone: p.phone || p.Phone || null,
                email: p.email || p.Email || null,
                source: 'CSV_UPLOAD',
                status: 'PENDING',
            })),
            skipDuplicates: true,
        });
        res.status(201).json({ message: `${created.count} prospects uploaded`, count: created.count });
    }
    catch (error) {
        console.error('POST /prospects/upload error:', error);
        res.status(500).json({ error: String(error) });
    }
});
// ── Get all prospects ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { status, page = '1', limit = '50' } = req.query;
        const where = { tenantId: req.user.tenantId };
        if (status)
            where.status = status;
        const [prospects, total] = await Promise.all([
            prisma.prospect.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: parseInt(limit),
                skip: (parseInt(page) - 1) * parseInt(limit),
            }),
            prisma.prospect.count({ where }),
        ]);
        res.json({ prospects, total, page: parseInt(page), limit: parseInt(limit) });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
// ── AI generate message for prospects ────────────────────────────────────────
router.post('/generate-message', async (req, res) => {
    try {
        const { businessType = 'general', goal, channel = 'SMS', productOrService } = req.body;
        if (!goal)
            return res.status(400).json({ error: 'goal is required' });
        const prompt = `You are a marketing copywriter for a ${businessType} business in Africa.

Write a personalised outreach message for cold prospects.
Goal: ${goal}
${productOrService ? `Product/Service: ${productOrService}` : ''}
Channel: ${channel}

Rules:
- Start with "Hi [First Name],"
- ${channel === 'SMS' ? 'Keep under 160 characters total' : 'Keep under 200 words'}
- Be friendly, not pushy
- Include one clear call to action
- End with business contact or reply instruction
- Make it relevant to African market

Return ONLY the message text, nothing else.`;
        const completion = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 300,
        });
        const message = completion.choices[0]?.message?.content?.trim() || '';
        res.json({ message });
    }
    catch (error) {
        console.error('POST /prospects/generate-message error:', error);
        res.status(500).json({ error: String(error) });
    }
});
// ── Blast message to all pending prospects ────────────────────────────────────
router.post('/blast', async (req, res) => {
    try {
        const { message, channel, prospectIds } = req.body;
        if (!message)
            return res.status(400).json({ error: 'message is required' });
        if (!channel)
            return res.status(400).json({ error: 'channel is required (SMS or EMAIL)' });
        const where = { tenantId: req.user.tenantId, status: 'PENDING' };
        if (prospectIds?.length > 0)
            where.id = { in: prospectIds };
        const prospects = await prisma.prospect.findMany({ where });
        if (prospects.length === 0)
            return res.status(400).json({ error: 'No pending prospects found' });
        const results = { sent: 0, failed: 0, errors: [] };
        for (const prospect of prospects) {
            const personalised = message.replace('[First Name]', prospect.firstName);
            let success = false;
            try {
                if (channel === 'SMS' && prospect.phone) {
                    const client = getTwilio();
                    await client.messages.create({
                        body: personalised,
                        from: process.env.TWILIO_PHONE_NUMBER,
                        to: prospect.phone,
                    });
                    success = true;
                }
                else if (channel === 'EMAIL' && prospect.email) {
                    const resend = getResend();
                    await resend.emails.send({
                        from: 'VoxelixHub <onboarding@resend.dev>',
                        to: prospect.email,
                        subject: `A message for you, ${prospect.firstName}`,
                        html: `<p>${personalised.replace(/\n/g, '<br/>')}</p>`,
                    });
                    success = true;
                }
                if (success) {
                    await prisma.prospect.update({
                        where: { id: prospect.id },
                        data: { status: 'SENT', message: personalised, sentAt: new Date() },
                    });
                    results.sent++;
                }
            }
            catch (err) {
                results.failed++;
                results.errors.push(`${prospect.firstName}: ${err.message}`);
            }
        }
        res.json({ success: true, ...results, total: prospects.length });
    }
    catch (error) {
        console.error('POST /prospects/blast error:', error);
        res.status(500).json({ error: String(error) });
    }
});
// ── Convert prospect to lead ──────────────────────────────────────────────────
router.post('/:id/convert', async (req, res) => {
    try {
        const prospect = await prisma.prospect.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!prospect)
            return res.status(404).json({ error: 'Prospect not found' });
        const lead = await prisma.lead.create({
            data: {
                tenantId: req.user.tenantId,
                firstName: prospect.firstName,
                lastName: prospect.lastName || null,
                phone: prospect.phone || null,
                email: prospect.email || null,
                source: 'PROSPECTING',
                status: 'NEW',
            },
        });
        await prisma.prospect.update({
            where: { id: prospect.id },
            data: { status: 'CONVERTED', convertedAt: new Date(), leadId: lead.id },
        });
        res.json({ message: 'Prospect converted to lead', lead });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
// ── Delete prospects ──────────────────────────────────────────────────────────
router.delete('/', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || ids.length === 0)
            return res.status(400).json({ error: 'ids array required' });
        await prisma.prospect.deleteMany({
            where: { id: { in: ids }, tenantId: req.user.tenantId },
        });
        res.json({ message: 'Prospects deleted' });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
exports.default = router;
//# sourceMappingURL=prospects.js.map