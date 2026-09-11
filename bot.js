const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const bodyParser = require('body-parser');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(bodyParser.json());

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});

const db = {
    users: {},
    referrals: {},
    transactions: {},
    walletLedger: {}
};

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

function getLang(userId) {
    return db.users[userId]?.lang || 'en';
}

function getMainMenu(lang) {
    const dict = t[lang];
    return Markup.keyboard([
        [dict.btnJoin],
        [dict.btnWallet, dict.btnRefer],
        [dict.btnLang]
    ]).resize();
}

bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const payload = ctx.startPayload;

    if (!db.users[userId]) {
        db.users[userId] = {
            lang: 'en',
            balance: 0,
            withdrawn: 0,
            active: false,
            referrer: null,
            referralId: 'REF' + userId
        };
        db.walletLedger[userId] = [];

        if (payload && payload !== db.users[userId].referralId) {
            const referrerId = Object.keys(db.users).find(
                id => db.users[id].referralId === payload
            );
            if (referrerId && referrerId !== userId) {
                db.users[userId].referrer = referrerId;
                db.referrals[userId] = referrerId;
            }
        }

        return ctx.reply(
            t.en.welcome,
            Markup.inlineKeyboard([
                [Markup.button.callback('🇬🇺 ગુજરાતી', 'lang_gu')],
                [Markup.button.callback('🇮🇳 हिन्दी', 'lang_hi')],
                [Markup.button.callback('🇬🇧 English', 'lang_en')]
            ])
        );
    }

    const lang = getLang(userId);
    return ctx.reply(t[lang].menu, getMainMenu(lang));
});

bot.action(/lang_(gu|hi|en)/, async (ctx) => {
    const userId = ctx.from.id.toString();
    const selectedLang = ctx.match[1];

    if (db.users[userId]) {
        db.users[userId].lang = selectedLang;
    }

    await ctx.answerCbQuery();
    await ctx.editMessageText(t[selectedLang].langChanged);
    return ctx.reply(t[selectedLang].menu, getMainMenu(selectedLang));
});

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

bot.hears(/Join/i, async (ctx) => {
    const userId = ctx.from.id.toString();
    const lang = getLang(userId);

    if (db.users[userId] && db.users[userId].active) {
        return ctx.reply(lang === 'gu' ? "તમે પહેલેથી જ Active Member છો!" : "You are already an Active Member!");
    }

    try {
        const order = await razorpay.orders.create({
            amount: 10000,
            currency: 'INR',
            receipt: 'rcpt_' + userId + '_' + Date.now(),
            notes: { userId: userId }
        });
        
        return ctx.reply(
            t[lang].joinPrompt,
            Markup.inlineKeyboard([
                [Markup.button.url(t[lang].payBtn, 'https://rzp.io/rzp/Dj8c5zXx')]
            ])
        );
    } catch (err) {
        console.error(err);
        return ctx.reply("Payment initialization failed. Please try again later.");
    }
});

bot.hears(/Refer/i, (ctx) => {
    const userId = ctx.from.id.toString();
    const lang = getLang(userId);
    const user = db.users[userId];

    const myReferralLink = `https://t.me/${bot.botInfo.username}?start=${user.referralId}`;
    
    const totalRef = Object.values(db.referrals).filter(refId => refId === userId).length;
    const successfulRef = Object.keys(db.referrals).filter(
        refrId => db.referrals[refrId] === userId && db.users[refrId]?.active
    ).length;
    const pendingRef = totalRef - successfulRef;
    const earnings = successfulRef * 50;

    let text = t[lang].referralInfo
        .replace('{link}', myReferralLink)
        .replace('{total}', totalRef)
        .replace('{success}', successfulRef)
        .replace('{pending}', pendingRef)
        .replace('{earnings}', earnings);

    return ctx.reply(text);
});

bot.hears(/Wallet/i, (ctx) => {
    const userId = ctx.from.id.toString();
    const lang = getLang(userId);
    const user = db.users[userId];

    let text = t[lang].walletInfo
        .replace('{balance}', user.balance)
        .replace('{withdrawn}', user.withdrawn);

    return ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback('💸 Withdraw Request', 'withdraw_req')]
    ]));
});

bot.action('withdraw_req', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.reply("Please send your UPI ID or Bank Details for withdrawal (e.g., /withdraw UPI_ID):");
});

bot.command('withdraw', (ctx) => {
    const userId = ctx.from.id.toString();
    const user = db.users[userId];
    const details = ctx.message.text.split(' ').slice(1).join(' ');

    if (!details) return ctx.reply("Please provide UPI ID. Format: /withdraw yourname@upi");
    if (user.balance < 100) return ctx.reply("Minimum withdrawal balance is ₹100.");

    const amountToWithdraw = user.balance;
    user.balance = 0;
    user.withdrawn += amountToWithdraw;

    db.walletLedger[userId].push({
        type: 'WITHDRAWAL',
        amount: -amountToWithdraw,
        desc: `Withdrawal to ${details}`,
        time: new Date()
    });

    return ctx.reply(`✅ Withdrawal request of ₹${amountToWithdraw} submitted successfully! Status: Pending Approval.`);
});

// Telegram Webhook Setup (Express Request ద్వారా ఆటోમેટિક URL સેટ થશે)
app.use(async (req, res, next) => {
    if (req.originalUrl === '/telegram-webhook') {
        return bot.handleUpdate(req.body, res);
    }
    next();
});

// Razorpay Webhook Endpoint
app.post('/razorpay-webhook', async (req, res) => {
    const shasum = crypto.createHmac('sha256', WEBHOOK_SECRET);
    shasum.update(JSON.stringify(req.body));
    const digest = shasum.digest('hex');

    if (digest !== req.headers['x-razorpay-signature']) {
        return res.status(400).json({ status: 'Invalid Signature' });
    }

    const event = req.body.event;

    if (event === 'payment.captured') {
        const paymentEntity = req.body.payload.payment.entity;
        const paymentId = paymentEntity.id;
        const userId = paymentEntity.notes.userId;

        if (db.transactions[paymentId]) {
            return res.status(200).json({ status: 'Already Processed' });
        }
        db.transactions[paymentId] = true;

        if (userId && db.users[userId]) {
            db.users[userId].active = true;

            const referrerId = db.users[userId].referrer;
            if (referrerId && db.users[referrerId]) {
                db.users[referrerId].balance += 50;

                db.walletLedger[referrerId].push({
                    type: 'REFERRAL_REWARD',
                    amount: 50,
                    desc: `Referral bonus from User ${userId}`,
                    time: new Date()
                });

                bot.telegram.sendMessage(
                    referrerId,
                    `🎉 Referral Reward! Your referred user made a successful payment. +₹50 added to your wallet!`
                ).catch(() => {});
            }

            bot.telegram.sendMessage(
                userId,
                `✅ Payment Successful! Your Membership is now Active.`
            ).catch(() => {});
        }
    }

    res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    // Telegram પર ઓટોમેટિક વેબહુક લિંક રજીસ્ટર કરવા માટે
    try {
        await bot.telegram.setWebhook(`https://vijaypath.onrender.com/telegram-webhook`);
        console.log("Telegram Webhook Set Successfully!");
    } catch (err) {
        console.error("Failed to set webhook:", err);
    }
});
        
