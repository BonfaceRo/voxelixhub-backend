"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
const groq = new groq_sdk_1.default({
    apiKey: process.env.GROQ_API_KEY,
});
router.use(auth_1.authMiddleware);
// ── Get messages for a lead ───────────────────────────────────────────────────
router.get('/lead/:leadId', async (req, res) => {
    try {
        const lead = await prisma.lead.findFirst({
            where: { id: req.params.leadId, tenantId: req.user.tenantId },
        });
        if (!lead)
            return res.status(404).json({ error: 'Lead not found' });
        const messages = await prisma.message.findMany({
            where: { leadId: req.params.leadId },
            orderBy: { createdAt: 'asc' },
        });
        res.json({ messages });
    }
    catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── Send a message ────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { leadId, content, channel } = req.body;
        if (!leadId || !content)
            return res.status(400).json({ error: 'Lead ID and content are required' });
        const lead = await prisma.lead.findFirst({
            where: { id: leadId, tenantId: req.user.tenantId },
        });
        if (!lead)
            return res.status(404).json({ error: 'Lead not found' });
        const message = await prisma.message.create({
            data: {
                leadId,
                direction: 'OUTBOUND',
                channel: channel || 'SMS',
                content,
                isAI: false,
            },
        });
        await prisma.lead.update({
            where: { id: leadId },
            data: { lastContactAt: new Date() },
        });
        res.status(201).json({ message });
    }
    catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});
// ── AI Reply using Groq ───────────────────────────────────────────────────────
router.post('/ai-reply', async (req, res) => {
    try {
        const { leadId, message, channel } = req.body;
        if (!leadId || !message)
            return res.status(400).json({ error: 'Lead ID and message are required' });
        const lead = await prisma.lead.findFirst({
            where: { id: leadId, tenantId: req.user.tenantId },
        });
        if (!lead)
            return res.status(404).json({ error: 'Lead not found' });
        const tenant = await prisma.tenant.findUnique({
            where: { id: req.user.tenantId },
        });
        const availableStock = await prisma.stock.findMany({
            where: { tenantId: req.user.tenantId, status: 'AVAILABLE' },
        });
        const stockList = availableStock.length > 0
            ? availableStock.map((s) => `- ${s.name}${s.price ? ` at R${s.price.toLocaleString()}` : ''}${s.description ? ` (${s.description})` : ''} — AVAILABLE`).join('\n')
            : 'No specific stock listed — ask customer what they are looking for and capture their details.';
        const previousMessages = await prisma.message.findMany({
            where: { leadId },
            orderBy: { createdAt: 'asc' },
            take: 10,
        });
        const conversationHistory = previousMessages.map((msg) => ({
            role: msg.direction === 'INBOUND' ? 'user' : 'assistant',
            content: msg.content,
        }));
        const completion = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [
                {
                    role: 'system',
                    content: `You are a professional and friendly sales assistant for ${tenant?.name || 'our business'}, a ${tenant?.businessType?.replace('_', ' ') || 'business'} in South Africa.

Your job is to:
1. Respond to customer enquiries professionally and helpfully
2. Qualify leads by asking about their needs and budget
3. Try to book appointments when appropriate
4. Be conversational and friendly but professional
5. Keep responses concise — under 100 words
6. Use South African context mention Rands not dollars
7. Always capture the customer name and phone number
8. Never make up information — only use what is provided below

CURRENT AVAILABLE STOCK:
${stockList}

IMPORTANT RULES:
- Only mention items listed as AVAILABLE above
- If asked about something not in stock say: "Let me check availability on that for you. Can I get your name and number so our team can confirm within 1 hour?"
- If no stock is listed ask what they are looking for and capture their details
- Always end with a question to keep conversation going

Lead name: ${lead.firstName} ${lead.lastName || ''}
Lead source: ${lead.source}
Lead status: ${lead.status}`,
                },
                ...conversationHistory,
                { role: 'user', content: message },
            ],
            max_tokens: 200,
            temperature: 0.7,
        });
        const aiResponse = completion.choices[0]?.message?.content || 'Thank you for your message. I will get back to you shortly.';
        await prisma.message.create({
            data: {
                leadId,
                direction: 'INBOUND',
                channel: channel || 'WHATSAPP',
                content: message,
                isAI: false,
            },
        });
        const aiMessage = await prisma.message.create({
            data: {
                leadId,
                direction: 'OUTBOUND',
                channel: channel || 'WHATSAPP',
                content: aiResponse,
                isAI: true,
                aiModel: 'llama-3.1-8b-instant',
            },
        });
        await prisma.lead.update({
            where: { id: leadId },
            data: {
                lastContactAt: new Date(),
                status: lead.status === 'NEW' ? 'CONTACTED' : lead.status,
            },
        });
        res.json({ message: aiMessage, aiResponse });
    }
    catch (error) {
        console.error('AI reply error:', error);
        res.status(500).json({ error: 'AI reply failed. Check your Groq API key.' });
    }
});
exports.default = router;
//# sourceMappingURL=messages.js.map