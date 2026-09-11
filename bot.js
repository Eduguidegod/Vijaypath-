const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const bodyParser = require('body-parser');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Configuration (તમારી API Keys અહીં ઉમેરો)
const BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
const RAZORPAY_KEY_ID = 'YOUR_RAZORPAY_KEY_ID';
const RAZORPAY_KEY_SECRET = 'YOUR_RAZORPAY_KEY_SECRET';
const WEBHOOK_SECRET = 'YOUR_RAZORPAY_WEBHOOK_SECRET';
const DOMAIN = 'https://yourdomain.com'; // Webhook URL માટે

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(bodyParser.json());

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});

// Mock Database (પ્રોડક્શનમાં MongoDB કે PostgreSQL વાપરવું)
const db = {
    users: {},     // userId -> { lang, balance, active, referrer, referralId, withdrawn }
    referrals: {}, // referredId -> referrerId
    transactions: {}, // paymentId -> processed (Duplicate Protection)
    walletLedger: {}  // userId -> [ {type, amount, desc, time} ]
};

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

function getLang(userId) {
    return db.users[userId]?.lang || 'en';
}

// Main Menu Keyboard
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
    const userId = ctx.from.id.toString();
    const payload = ctx.startPayload; // Referral ID if passed

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

        // Handle Referral Link Tracking (Duplicate Referral Protection)
        if (payload && payload !== db.users[userId].referralId) {
            // Find referrer by referralId
            const referrerId = Object.keys(db.users).find(
                id => db.users[id].referralId === payload
            );
            if (referrerId && referrerId !== userId) {
                db.users[userId].referrer = referrerId;
                db.referrals[userId] = referrerId;
            }
        }

        // Show Language Selection for new user
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

// 2. Language Selection Callbacks
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

// 7 & 8. Join & Razorpay Order Creation
bot.hears(/Join/i, async (ctx) => {
    const userId = ctx.from.id.toString();
    const lang = getLang(userId);

    if (db.users[userId] && db.users[userId].active) {
        return ctx.reply(lang === 'gu' ? "તમે પહેલેથી જ Active Member છો!" : "You are already an Active Member!");
    }

    try {
        const order = await razorpay.orders.create({
            amount: 10000, // ₹100 inpaise
            currency: 'INR',
            receipt: 'rcpt_' + userId + '_' + Date.now(),
            notes: { userId: userId }
        });

        // Payment Link / Checkout URL (Using Razorpay standard link or Web App)
        const paymentUrl = `https://api.razorpay.com/v1/checkout/embedded?key_id=${RAZORPAY_KEY_ID}&order_id=${order.id}`; 
        // Note: For Telegram bots, you can use Telegram Payments API or send an Invoice / Payment URL.
        
        return ctx.reply(
            t[lang].joinPrompt,
            Markup.inlineKeyboard([
                [Markup.button.url(t[lang].payBtn, `https://rzp.io/i/YOUR_PAYMENT_PAGE_LINK`)] // અથવા તમારું Web App / Gateway URL
            ])
        );
    } catch (err) {
        console.error(err);
        return ctx.reply("Payment initialization failed. Please try again later.");
    }
});

// 13. My Referrals / Refer Menu
bot.hears(/Refer/i, (ctx) => {
    const userId = ctx.from.id.toString();
    const lang = getLang(userId);
    const user = db.users[userId];

    const myReferralLink = `https://t.me/${bot.botInfo.username}?start=${user.referralId}`;
    
    // Calculate stats
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

// 14 & 15. My Wallet & Withdraw
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


// 8, 9, 10, 12, 16. Razorpay Webhook for Payment Verification & Duplicate Protection
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

        // 16. Duplicate Payment Protection
        if (db.transactions[paymentId]) {
            return res.status(200).json({ status: 'Already Processed' });
        }
        db.transactions[paymentId] = true;

        if (userId && db.users[userId]) {
            // 9 & 10. Membership Active & Referral Reward (+₹50)
            db.users[userId].active = true;

            const referrerId = db.users[userId].referrer;
            if (referrerId && db.users[referrerId]) {
                db.users[referrerId].balance += 50;

                // 18. Wallet Ledger Entry
                db.walletLedger[referrerId].push({
                    type: 'REFERRAL_REWARD',
                    amount: 50,
                    desc: `Referral bonus from User ${userId}`,
                    time: new Date()
                });

                // Notify Referrer via Telegram Bot
                bot.telegram.sendMessage(
                    referrerId,
                    `🎉 Referral Reward! Your referred user made a successful payment. +₹50 added to your wallet!`
                ).catch(() => {});
            }

            // Notify User
            bot.telegram.sendMessage(
                userId,
                `✅ Payment Successful! Your Membership is now Active.`
            ).catch(() => {});
        }
    }

    res.json({ status: 'ok' });
});

// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    bot.launch();
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
  
