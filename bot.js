const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const bodyParser = require('body-parser');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');

// Environment Variables માંથી વિગતો મેળવવી
const BOT_TOKEN = process.env.BOT_TOKEN;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const MONGODB_URI = process.env.MONGODB_URI;

// MongoDB Atlas કનેક્શન (Permanent Database)
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// Mongoose Schemas & Models
const ledgerSchema = new mongoose.Schema({
    type: String,
    amount: Number,
    desc: String,
    time: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    lang: { type: String, default: 'en' },
    balance: { type: Number, default: 0 },
    withdrawn: { type: Number, default: 0 },
    active: { type: Boolean, default: false },
    referrer: { type: String, default: null },
    referralId: { type: String, required: true },
    walletLedger: [ledgerSchema]
});

const referralSchema = new mongoose.Schema({
    referredId: { type: String, required: true, unique: true },
    referrerId: { type: String, required: true }
});

const transactionSchema = new mongoose.Schema({
    paymentId: { type: String, required: true, unique: true }
});

const User = mongoose.model('User', userSchema);
const Referral = mongoose.model('Referral', referralSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// સામાન્ય રાઉટ્સ માટે JSON બોડી પાર્સર
app.use(express.json());

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});

// Translations Dictionary
const t = {
    gu: {
        welcome: "નમસ્તે! Telegram Referral Bot માં આપનું સ્વાગત છે. કૃપા કરીને તમારી ભાષા પસંદ કરો:",
        menu: "મુખ્ય મેનુ પસંદ કરો:",
        btnJoin: "① Join (₹100)",
        btnWallet: "② My Wallet / Withdraw",
        btnRefer: "③ My Referrals / Refer",
        btnLang: "🌐 Change Language",
        langChanged: "ભાષા સફળતાપૂર્વક બદલાઈ ગઈ છે!",
        joinPrompt: "સભ્યપદ મેળવવા માટે નીચેના બટન પર ક્લિક કરીને ₹100 ચૂકવો:",
        payBtn: "💳 Pay ₹100 Now",
        walletInfo: "💰 તમારું વૉલેટ:\n\nકુલ બેલેન્સ: ₹{balance}\nઉપાડેલી રકમ: ₹{withdrawn}",
        referralInfo: "🔗 તમારી રેફરલ માહિતી:\n\nતમારી લિંક: {link}\nકુલ રેફરલ્સ: {total}\nસફળ (Successful): {success}\nપેન્ડિંગ: {pending}\nકમાણી: ₹{earnings}"
    },
    hi: {
        welcome: "नमस्ते! Telegram Referral Bot में आपका स्वागत है। कृपया अपनी भाषा चुनें:",
        menu: "मुख्य मेनू चुनें:",
        btnJoin: "① Join (₹100)",
        btnWallet: "② My Wallet / Withdraw",
        btnRefer: "③ My Referrals / Refer",
        btnLang: "🌐 Change Language",
        langChanged: "भाषा सफलतापूर्वक बदल दी गई है!",
        joinPrompt: "सदस्यता प्राप्त करने के लिए नीचे दिए गए बटन पर क्लिक करके ₹100 का भुगतान करें:",
        payBtn: "💳 Pay ₹100 Now",
        walletInfo: "💰 आपका वॉलेट:\n\nकुल बैलेंस: ₹{balance}\nनिकासी राशि: ₹{withdrawn}",
        referralInfo: "🔗 आपकी रेफरल जानकारी:\n\nआपकी लिंक: {link}\nकुल रेफरल्स: {total}\nसफल: {success}\nलंबित (Pending): {pending}\nकमाई: ₹{earnings}"
    },
    en: {
        welcome: "Hello! Welcome to Telegram Referral Bot. Please select your language:",
        menu: "Select Main Menu:",
        btnJoin: "① Join (₹100)",
        btnWallet: "② My Wallet / Withdraw",
        btnRefer: "③ My Referrals / Refer",
        btnLang: "🌐 Change Language",
        langChanged: "Language successfully changed!",
        joinPrompt: "Click the button below to pay ₹100 for membership:",
        payBtn: "💳 Pay ₹100 Now",
        walletInfo: "💰 Your Wallet:\n\nCurrent Balance: ₹{balance}\nWithdrawn Amount: ₹{withdrawn}",
        referralInfo: "🔗 Your Referral Info:\n\nYour Link: {link}\nTotal Referrals: {total}\nSuccessful: {success}\nPending: {pending}\nEarnings: ₹{earnings}"
    }
};

function getMainMenu(lang) {
    const dict = t[lang];
    return Markup.keyboard([
        [dict.btnJoin],
        [dict.btnWallet, dict.btnRefer],
        [dict.btnLang]
    ]).resize();
}

// 1. /start Command & Referral Handling
bot.start(async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const payload = ctx.startPayload;

        let user = await User.findOne({ userId });

        if (!user) {
            user = new User({
                userId,
                lang: 'en',
                balance: 0,
                withdrawn: 0,
                active: false,
                referrer: null,
                referralId: 'REF' + userId,
                walletLedger: []
            });

            if (payload && payload !== user.referralId) {
                const referrerUser = await User.findOne({ referralId: payload });
                if (referrerUser && referrerUser.userId !== userId) {
                    user.referrer = referrerUser.userId;
                    await Referral.create({ referredId: userId, referrerId: referrerUser.userId });
                }
            }

            await user.save();

            return ctx.reply(
                t.en.welcome,
                Markup.inlineKeyboard([
                    [Markup.button.callback('🇬🇺 ગુજરાતી', 'lang_gu')],
                    [Markup.button.callback('🇮🇳 हिन्दी', 'lang_hi')],
                    [Markup.button.callback('🇬🇧 English', 'lang_en')]
                ])
            );
        }

        return ctx.reply(t[user.lang].menu, getMainMenu(user.lang));
    } catch (err) {
        console.error("Error in /start command:", err);
        return ctx.reply("An error occurred. Please try again later.");
    }
});

// 2. Language Selection Callbacks
bot.action(/lang_(gu|hi|en)/, async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const selectedLang = ctx.match[1];

        await User.findOneAndUpdate({ userId }, { lang: selectedLang });

        await ctx.answerCbQuery();
        await ctx.editMessageText(t[selectedLang].langChanged);
        return ctx.reply(t[selectedLang].menu, getMainMenu(selectedLang));
    } catch (err) {
        console.error("Error in language selection:", err);
        return ctx.reply("An error occurred.");
    }
});

// 3. Change Language Handler from Menu
bot.hears(['🌐 Change Language', '🌐 भाषा बदलें', '🌐 ભાષા બદલો'], (ctx) => {
    return ctx.reply(
        "Select Language / ભાષા પસંદ કરો / भाषा चुनें:",
        Markup.inlineKeyboard([
            [Markup.button.callback('🇬🇺 ગુજરાતી', 'lang_gu')],
            [Markup.button.callback('🇮🇳 हिन्दी', 'lang_hi')],
            [Markup.button.callback('🇬🇧 English', 'lang_en')]
        ])
    );
});

// Join & Razorpay Dynamic Payment Link Generation via API
bot.hears(/Join/i, async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const user = await User.findOne({ userId });
        const lang = user ? user.lang : 'en';

        if (user && user.active) {
            return ctx.reply(lang === 'gu' ? "તમે પહેલેથી જ Active Member છો!" : "You are already an Active Member!");
        }

        const paymentLinkResponse = await razorpay.paymentLinks.create({
            amount: 10000, // ₹100 in paisa
            currency: 'INR',
            accept_partial: false,
            description: 'Telegram Bot Membership Fee',
            customer: {
                name: ctx.from.first_name || 'User',
                email: 'support@vijaypath.com'
            },
            notify: { sms: false, email: false },
            reminder_enable: false,
            notes: {
                userId: userId
            },
            callback_url: 'https://t.me/Vijaypathj_bot',
            callback_method: 'get'
        });

        return ctx.reply(
            t[lang].joinPrompt,
            Markup.inlineKeyboard([
                [Markup.button.url(t[lang].payBtn, paymentLinkResponse.short_url)]
            ])
        );
    } catch (err) {
        console.error("Error in Join command / Payment Link creation:", err);
        return ctx.reply("Payment initialization failed. Please try again later.");
    }
});

// My Referrals / Refer Menu
bot.hears(/Refer/i, async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const user = await User.findOne({ userId });
        if (!user) return ctx.reply("Please send /start first.");

        const lang = user.lang;
        const myReferralLink = `https://t.me/Vijaypathj_bot?start=${user.referralId}`;
        
        const totalRef = await Referral.countDocuments({ referrerId: userId });
        
        const referralsList = await Referral.find({ referrerId: userId });
        let successfulRef = 0;
        for (let ref of referralsList) {
            const referredUser = await User.findOne({ userId: ref.referredId });
            if (referredUser && referredUser.active) {
                successfulRef++;
            }
        }

        const pendingRef = totalRef - successfulRef;
        const earnings = successfulRef * 50;

        let text = t[lang].referralInfo
            .replace('{link}', myReferralLink)
            .replace('{total}', totalRef)
            .replace('{success}', successfulRef)
            .replace('{pending}', pendingRef)
            .replace('{earnings}', earnings);

        return ctx.reply(text);
    } catch (err) {
        console.error("Error in Refer menu:", err);
        return ctx.reply("An error occurred.");
    }
});

// My Wallet & Withdraw
bot.hears(/Wallet/i, async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const user = await User.findOne({ userId });
        if (!user) return ctx.reply("Please send /start first.");

        const lang = user.lang;
        let text = t[lang].walletInfo
            .replace('{balance}', user.balance)
            .replace('{withdrawn}', user.withdrawn);

        return ctx.reply(text, Markup.inlineKeyboard([
            [Markup.button.callback('💸 Withdraw Request', 'withdraw_req')]
        ]));
    } catch (err) {
        console.error("Error in Wallet menu:", err);
        return ctx.reply("An error occurred.");
    }
});

bot.action('withdraw_req', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.reply("Please send your UPI ID or Bank Details for withdrawal (e.g., /withdraw UPI_ID):");
});

bot.command('withdraw', async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const user = await User.findOne({ userId });
        if (!user) return ctx.reply("Please send /start first.");

        const details = ctx.message.text.split(' ').slice(1).join(' ');

        if (!details) return ctx.reply("Please provide UPI ID. Format: /withdraw yourname@upi");
        if (user.balance < 100) return ctx.reply("Minimum withdrawal balance is ₹100.");

        const amountToWithdraw = user.balance;
        user.balance = 0;
        user.withdrawn += amountToWithdraw;

        user.walletLedger.push({
            type: 'WITHDRAWAL',
            amount: -amountToWithdraw,
            desc: `Withdrawal to ${details}`,
            time: new Date()
        });

        await user.save();

        return ctx.reply(`✅ Withdrawal request of ₹${amountToWithdraw} submitted successfully! Status: Pending Approval.`);
    } catch (err) {
        console.error("Error in withdraw command:", err);
        return ctx.reply("An error occurred while processing withdrawal.");
    }
});

// SECURE ADMIN PANEL
bot.command('admin', async (ctx) => {
    try {
        const userId = ctx.from.id.toString();

        if (userId !== ADMIN_TELEGRAM_ID) {
            return ctx.reply("⛔ You are not authorized to use the admin panel.");
        }

        const totalUsers = await User.countDocuments();
        const activeMembers = await User.countDocuments({ active: true });
        const totalPayments = await Transaction.countDocuments();
        const totalEarningsCollected = totalPayments * 100;

        const users = await User.find();
        let withdrawalSummary = 0;
        users.forEach(u => {
            withdrawalSummary += u.withdrawn;
        });

        let adminText = `👑 **Admin Dashboard / Statistics**\n\n`;
        adminText += `👥 Total Users: ${totalUsers}\n`;
        adminText += `✅ Active Members: ${activeMembers}\n`;
        adminText += `💳 Total Payments (₹100): ${totalPayments} (₹${totalEarningsCollected})\n`;
        adminText += `💸 Total Withdrawn Amount: ₹${withdrawalSummary}\n`;

        return ctx.replyWithMarkdown(adminText);
    } catch (err) {
        console.error("Error in admin command:", err);
        return ctx.reply("Error loading admin stats.");
    }
});

// Telegram Webhook Middleware
app.use(bot.webhookCallback('/telegram-webhook'));

// Razorpay Webhook Endpoint (Using express.raw to prevent signature verification failure)
app.post('/razorpay-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const shasum = crypto.createHmac('sha256', WEBHOOK_SECRET);
        shasum.update(req.body); // req.body is Buffer here
        const digest = shasum.digest('hex');

        if (digest !== req.headers['x-razorpay-signature']) {
            return res.status(400).json({ status: 'Invalid Signature' });
        }

        const reqBody = JSON.parse(req.body.toString());
        const event = reqBody.event;

        if (event === 'payment_link.paid' || event === 'payment.captured') {
            const entity = reqBody.payload.payment_link ? reqBody.payload.payment_link.entity : reqBody.payload.payment.entity;
            const paymentId = entity.id;
            const userId = entity.notes ? entity.notes.userId : null;

            if (!userId) {
                return res.status(200).json({ status: 'No User ID found in notes' });
            }

            const existingTx = await Transaction.findOne({ paymentId });
            if (existingTx) {
                return res.status(200).json({ status: 'Already Processed' });
            }
            await Transaction.create({ paymentId });

            const user = await User.findOne({ userId });
            if (user) {
                user.active = true;

                if (user.referrer) {
                    const referrerUser = await User.findOne({ userId: user.referrer });
                    if (referrerUser) {
                        referrerUser.balance += 50;
                        referrerUser.walletLedger.push({
                            type: 'REFERRAL_REWARD',
                            amount: 50,
                            desc: `Referral bonus from User ${userId}`,
                            time: new Date()
                        });
                        await referrerUser.save();

                        bot.telegram.sendMessage(
                            user.referrer,
                            `🎉 Referral Reward! Your referred user made a successful payment. +₹50 added to your wallet!`
                        ).catch((e) => console.error("Notification error:", e));
                    }
                }

                await user.save();

                bot.telegram.sendMessage(
                    userId,
                    `✅ Payment Successful! Your Membership is now Active.`
                ).catch((e) => console.error("Notification error:", e));
            }
        }

        res.json({ status: 'ok' });
    } catch (err) {
        console.error("Error in razorpay webhook:", err);
        res.status(500).json({ status: 'error' });
    }
});

// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    try {
        await bot.telegram.setWebhook(`https://vijaypath.onrender.com/telegram-webhook`);
        console.log("Telegram Webhook Set Successfully!");
    } catch (err) {
        console.error("Failed to set webhook:", err);
    }
});
            
