"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const compression_1 = __importDefault(require("compression"));
// Routes
const auth_1 = __importDefault(require("./routes/auth"));
const leads_1 = __importDefault(require("./routes/leads"));
const messages_1 = __importDefault(require("./routes/messages"));
const stock_1 = __importDefault(require("./routes/stock"));
const campaigns_1 = __importDefault(require("./routes/campaigns"));
const ai_1 = __importDefault(require("./routes/ai"));
const sms_1 = __importDefault(require("./routes/sms"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const prospects_1 = __importDefault(require("./routes/prospects"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
// ── CORS ──────────────────────────────────────────────────────────────────────
app.use((0, cors_1.default)({
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
// ── Middleware ────────────────────────────────────────────────────────────────
app.use((0, helmet_1.default)({ crossOriginResourcePolicy: false }));
app.use((0, compression_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, morgan_1.default)('dev'));
// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'VoxelixHub API is running',
        timestamp: new Date().toISOString(),
    });
});
// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/v1/auth', auth_1.default);
app.use('/v1/leads', leads_1.default);
app.use('/v1/messages', messages_1.default);
app.use('/v1/stock', stock_1.default);
app.use('/v1/campaigns', campaigns_1.default);
app.use('/v1/ai', ai_1.default);
app.use('/v1/sms', sms_1.default);
app.use('/v1/analytics', analytics_1.default);
app.use('/v1/prospects', prospects_1.default);
// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
});
// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 VoxelixHub API running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
});
exports.default = app;
//# sourceMappingURL=index.js.map