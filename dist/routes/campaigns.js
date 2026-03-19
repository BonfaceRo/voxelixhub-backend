"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const resend_1 = require("resend");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
router.use(auth_1.authMiddleware);
// ── Get all campaigns ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const campaigns = await prisma.campaign.findMany({
            where: { tenantId: req.user.tenantId },
            include: { steps: true, _count: { select: { enrollments: true } } },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ campaigns });
    }
    catch (error) {
        console.error('GET /campaigns error:', error);
        res.status(500).json({ error: String(error) });
    }
});
// ── Create campaign ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { name, description, channel, trigger, triggerValue, steps } = req.body;
        if (!name)
            return res.status(400).json({ error: 'Name is required' });
        if (!channel)
            return res.status(400).json({ error: 'Channel is required (EMAIL or SMS)' });
        if (!steps || steps.length === 0)
            return res.status(400).json({ error: 'At least one step is required' });
        const campaign = await prisma.campaign.create({
            data: {
                tenantId: req.user.tenantId,
                name,
                description: description || null,
                channel: channel.toUpperCase(),
                trigger: trigger || 'MANUAL',
                triggerValue: triggerValue || null,
                status: 'DRAFT',
                steps: {
                    create: steps.map((step, index) => ({
                        stepNumber: index + 1,
                        delayDays: parseInt(step.delayDays) || 0,
                        subject: step.subject || null,
                        body: step.body,
                    })),
                },
            },
            include: { steps: true },
        });
        res.status(201).json({ message: 'Campaign created', campaign });
    }
    catch (error) {
        console.error('POST /campaigns error:', error);
        res.status(500).json({ error: String(error) });
    }
});
// ── Activate / pause campaign ─────────────────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const allowed = ['ACTIVE', 'PAUSED', 'DRAFT', 'ARCHIVED'];
        if (!allowed.includes(status))
            return res.status(400).json({ error: 'Invalid status' });
        const existing = await prisma.campaign.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing)
            return res.status(404).json({ error: 'Campaign not found' });
        const campaign = await prisma.campaign.update({
            where: { id: req.params.id },
            data: { status },
        });
        res.json({ message: `Campaign ${status.toLowerCase()}`, campaign });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
// ── Enroll a lead into a campaign ─────────────────────────────────────────────
router.post('/:id/enroll', async (req, res) => {
    try {
        const { leadId } = req.body;
        if (!leadId)
            return res.status(400).json({ error: 'leadId is required' });
        const campaign = await prisma.campaign.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
            include: { steps: { orderBy: { stepNumber: 'asc' } } },
        });
        if (!campaign)
            return res.status(404).json({ error: 'Campaign not found' });
        if (campaign.status !== 'ACTIVE')
            return res.status(400).json({ error: 'Campaign must be ACTIVE to enroll leads' });
        const lead = await prisma.lead.findFirst({
            where: { id: leadId, tenantId: req.user.tenantId },
        });
        if (!lead)
            return res.status(404).json({ error: 'Lead not found' });
        const firstStep = campaign.steps[0];
        const nextSendAt = new Date();
        nextSendAt.setDate(nextSendAt.getDate() + (firstStep?.delayDays || 0));
        const enrollment = await prisma.campaignEnrollment.upsert({
            where: { campaignId_leadId: { campaignId: campaign.id, leadId } },
            create: {
                campaignId: campaign.id,
                leadId,
                currentStep: 1,
                status: 'ACTIVE',
                nextSendAt,
            },
            update: {
                status: 'ACTIVE',
                currentStep: 1,
                nextSendAt,
                completedAt: null,
            },
        });
        res.status(201).json({ message: 'Lead enrolled', enrollment });
    }
    catch (error) {
        console.error('POST /enroll error:', error);
        res.status(500).json({ error: String(error) });
    }
});
// ── Send next step for a single enrollment (manual trigger) ───────────────────
router.post('/send/:enrollmentId', async (req, res) => {
    try {
        const enrollment = await prisma.campaignEnrollment.findUnique({
            where: { id: req.params.enrollmentId },
            include: {
                campaign: { include: { steps: { orderBy: { stepNumber: 'asc' } } } },
                lead: true,
            },
        });
        if (!enrollment)
            return res.status(404).json({ error: 'Enrollment not found' });
        if (enrollment.status !== 'ACTIVE')
            return res.status(400).json({ error: 'Enrollment is not active' });
        const step = enrollment.campaign.steps.find(s => s.stepNumber === enrollment.currentStep);
        if (!step) {
            await prisma.campaignEnrollment.update({
                where: { id: enrollment.id },
                data: { status: 'COMPLETED', completedAt: new Date() },
            });
            return res.json({ message: 'Campaign completed for this lead' });
        }
        const lead = enrollment.lead;
        let externalId = null;
        let sendStatus = 'SENT';
        let failedReason = null;
        if (enrollment.campaign.channel === 'EMAIL') {
            if (!lead.email) {
                return res.status(400).json({ error: 'Lead has no email address' });
            }
            try {
                const { data } = await resend.emails.send({
                    from: 'VoxelixHub <onboarding@resend.dev>',
                    to: lead.email,
                    subject: step.subject || 'Message from us',
                    html: step.body,
                });
                externalId = data?.id || null;
            }
            catch (emailErr) {
                sendStatus = 'FAILED';
                failedReason = emailErr.message;
            }
        }
        await prisma.campaignLog.create({
            data: {
                enrollmentId: enrollment.id,
                stepId: step.id,
                channel: enrollment.campaign.channel,
                to: lead.email || lead.phone || '',
                status: sendStatus,
                externalId,
                failedReason,
            },
        });
        const nextStep = enrollment.campaign.steps.find(s => s.stepNumber === enrollment.currentStep + 1);
        if (nextStep) {
            const nextSendAt = new Date();
            nextSendAt.setDate(nextSendAt.getDate() + nextStep.delayDays);
            await prisma.campaignEnrollment.update({
                where: { id: enrollment.id },
                data: { currentStep: nextStep.stepNumber, nextSendAt },
            });
        }
        else {
            await prisma.campaignEnrollment.update({
                where: { id: enrollment.id },
                data: { status: 'COMPLETED', completedAt: new Date() },
            });
        }
        res.json({ message: 'Step sent', status: sendStatus, externalId });
    }
    catch (error) {
        console.error('POST /send error:', error);
        res.status(500).json({ error: String(error) });
    }
});
// ── Get campaign analytics ────────────────────────────────────────────────────
router.get('/:id/analytics', async (req, res) => {
    try {
        const campaign = await prisma.campaign.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!campaign)
            return res.status(404).json({ error: 'Campaign not found' });
        const logs = await prisma.campaignLog.findMany({
            where: { enrollment: { campaignId: campaign.id } },
        });
        const stats = {
            total: logs.length,
            sent: logs.filter(l => l.status === 'SENT').length,
            delivered: logs.filter(l => l.status === 'DELIVERED').length,
            opened: logs.filter(l => l.status === 'OPENED').length,
            failed: logs.filter(l => l.status === 'FAILED').length,
            openRate: logs.length > 0
                ? ((logs.filter(l => l.openedAt).length / logs.length) * 100).toFixed(1) + '%'
                : '0%',
        };
        res.json({ campaign, stats });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
// ── Delete campaign ───────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const existing = await prisma.campaign.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing)
            return res.status(404).json({ error: 'Campaign not found' });
        await prisma.campaign.delete({ where: { id: req.params.id } });
        res.json({ message: 'Campaign deleted' });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
exports.default = router;
//# sourceMappingURL=campaigns.js.map