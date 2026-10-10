import os
import random
import urllib.parse
import hmac
import hashlib
from datetime import datetime, timezone
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from pymongo import MongoClient
import telebot
from telebot.types import (
    ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardMarkup, InlineKeyboardButton
)
import razorpay

# ==========================================
# ૧. કન્ફિગ્યુરેશન (CONFIG & CONSTANTS)
# ==========================================
load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
BOT_USERNAME = os.getenv("BOT_USERNAME", "").replace("@", "")

MONGO_URI = os.getenv("MONGO_URI", "")
DB_NAME = os.getenv("DB_NAME", "lottery_db")

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")

TOTAL_TICKETS_LIMIT = 80000
MAX_TICKETS_PER_USER = 10
REGULAR_PRICE = 50
DISCOUNTED_PRICE = 25
REFERRAL_BONUS = 25
MIN_WITHDRAWAL = 100

# ==========================================
# ૨. ત્રિભાષી મેસેજીસ (TRANSLATIONS)
# ==========================================
MESSAGES = {
    "gu": {
        "choose_lang": "કૃપા કરીને તમારી ભાષા પસંદ કરો / Please select your language:",
        "lang_set": "ભાષા સફળતાપૂર્વક સેટ થઈ ગઈ છે!",
        "menu_buy": "🎟️ ટિકિટ ખરીદો",
        "menu_my_tickets": "📋 મારી ટિકિટો",
        "menu_refer": "🤝 રેફરલ લિંક",
        "menu_wallet": "💰 મારું વોલેટ",
        "menu_prizes": "🏆 ઇનામ સૂચિ",
        "menu_lang": "🌐 ભાષા બદલો",
        "welcome": (
            "👋 લકી ડ્રો બોટમાં આપનું સ્વાગત છે!\n\n"
            "🎟️ ટિકિટ કિંમત: ₹50\n"
            "🏆 પ્રથમ ઇનામ: ₹1,00,000\n"
            "👥 કુલ ૨,૫૦૦ વિજેતાઓ જાહેર થશે!\n\n"
            "નીચે આપેલા મેનૂમાંથી વિકલ્પ પસંદ કરો."
        ),
        "limit_reached": "❌ તમે પહેલેથી મહત્તમ ૧૦ ટિકિટ ખરીદી લીધી છે. વધુ ટિકિટ ખરીદી શકાતી નથી.",
        "sold_out": "❌ તમામ ૮૦,૦૦૦ ટિકિટો વેચાઈ ગઈ છે! હવે ડ્રોની તૈયારી ચાલુ છે.",
        "buy_prompt": (
            "🎟️ **નવી ટિકિટ ખરીદો**\n\n"
            "તમારી ખરીદેલી ટિકિટો: {user_count}/10\n"
            "કુલ વેચાયેલી ટિકિટો: {total_sold}/80,000\n\n"
            "{price_text}\n"
            "ચૂકવણી પદ્ધતિ પસંદ કરો:"
        ),
        "pay_full_price": "કિંમત: ₹50",
        "pay_discount_price": "🎉 ૫૦% છૂટ સાથે કિંમત: ₹25 (પ્રથમ રેફરલ ઑફર!)",
        "btn_pay_gateway": "💳 UPI / Razorpay થી ચૂકવો",
        "btn_pay_wallet": "💰 વોલેટમાંથી ચૂકવો",
        "wallet_insufficient": "⚠️ વોલેટમાં પૂરતા પૈસા નથી. જરૂરી: ₹{req}, ઉપલબ્ધ: ₹{bal}.",
        "ticket_success": "🎉 અભિનંદન! તમારી ટિકિટ જનરેટ થઈ ગઈ છે.\n\n🎟️ ટિકિટ નંબર: `{ticket_no}`",
        "no_tickets": "તમારી પાસે હાલમાં કોઈ માન્ય ટિકિટ નથી. '🎟️ ટિકિટ ખરીદો' બટન દબાવો.",
        "my_tickets_title": "📋 **તમારી ખરીદેલી ટિકિટો ({count}/10):**\n\n{list}\n\nℹ️ ડ્રો ૮૦,૦૦૦ ટિકિટો પૂરી થતાં જાહેર થશે.",
        "refer_text": (
            "🤝 **રેફર કરો અને અમર્યાદિત કમાઓ!**\n\n"
            "🎁 **પ્રથમ રેફરલ:** ટિકિટ પર સીધું **૫૦% OFF** (માત્ર ₹૨૫ માં ટિકિટ)!\n"
            "💰 **બીજા રેફરલથી:** દરેક સફળ રેફરલ પર **અનલિમિટેડ ₹૨૫** તમારા વોલેટમાં જમા!\n\n"
            "💸 વોલેટમાં ₹૧૦૦ થતાં જ સીધા તમારા બેંક ખાતા/UPI માં ઉપાડી શકો છો અથવા નવી ટિકિટ ખરીદી શકો છો.\n\n"
            "🔗 **તમારી રેફરલ લિંક:**\n`{link}`\n\n"
            "👥 સફળ રેફરલ્સ: **{count}** મિત્રો"
        ),
        "share_whatsapp_btn": "🟢 WhatsApp પર શેર કરો",
        "share_telegram_btn": "✈️ Telegram માં શેર કરો",
        "share_caption": (
            "🔥 લકી ડ્રો માં જીતો ₹૧ લાખ સુધીના આકર્ષક ઇનામો! 🏆\n"
            "🎟️ ટિકિટ માત્ર ₹૫૦ માં!\n"
            "🎁 મારી લિંકથી જોડાઓ અને પ્રથમ ટિકિટ પર મેળવો ૫૦% OFF!\n"
            "👉 અહીં ક્લિક કરો: {link}"
        ),
        "wallet_info": (
            "💰 **તમારું વોલેટ બેલેન્સ:**\n\n"
            "ઉપલબ્ધ રકમ: **₹{bal}**\n"
            "સફળ રેફરલ્સ: {count}\n\n"
            "ℹ️ ન્યૂનતમ વિથડ્રોઅલ: ₹100\n"
            "ℹ️ વોલેટથી સીધી ટિકિટ પણ ખરીદી શકાય છે."
        ),
        "btn_withdraw": "💸 પૈસા ઉપાડો (Withdraw)",
        "withdraw_min_err": "⚠️ ન્યૂનતમ વિથડ્રોઅલ ₹100 છે. હાલ તમારું બેલેન્સ ₹{bal} છે.",
        "ask_upi": "કૃપા કરીને તમારો ૧૨ આંકડાનો સાચો UPI ID મોકલો (દા.ત. `mobile@upi` અથવા `name@okhdfcbank`):",
        "withdraw_submitted": "✅ વિથડ્રોઅલ રિક્વેસ્ટ સફળતાપૂર્વક મોકલાઈ ગઈ છે! એડમિન વેરિફાય કરીને રકમ ટ્રાન્સફર કરશે.",
        "invalid_upi": "❌ અમાન્ય UPI ID! કૃપા કરીને સાચો UPI આઈડી ફરી લખીને મોકલો.",
        "prize_list": (
            "🏆 **લકી ડ્રો ઇનામ સૂચિ** 🏆\n\n"
            "🥇 ૧ લો નંબર: ₹૧,૦૦,૦૦૦\n"
            "🥈 ૨ થી ૧૦ નંબર: ₹૫૦,૦૦૦\n"
            "🥉 ૧૧ થી ૨૦ નંબર: ₹૨૦,૦૦૦\n"
            "🎖️ ૨૧ થી ૫૦ નંબર: ₹૧૦,૦૦૦\n"
            "🎖️ ૫૧ થી ૧૦૦ નંબર: ₹૫,૦૦૦\n"
            "🎖️ ૧૦૧ થી ૫૦૦ નંબર: ₹૨,૦૦૦\n"
            "🎖️ ૫૦૧ થી ૧૦૦૦ નંબર: ₹૫૦૦\n"
            "🎖️ ૧૦૦૧ થી ૨૫૦૦ નંબર: ₹૫૦\n\n"
            "*(કુલ ૨,૫૦૦ વિજેતાઓ ૮૦,૦૦૦ ટિકિટો પૂરી થતાં જાહેર થશે!)*"
        ),
        "ref_notify_discount": "🎉 તમારા રેફરલથી મિત્રએ ટિકિટ ખરીદી! તમને આગલી ટિકિટ પર ૫૦% છૂટ મળી છે.",
        "ref_notify_bonus": "🎉 તમારા રેફરલથી મિત્રએ ટિકિટ ખરીદી! તમારા વોલેટમાં ₹૨૫ જમા થયા છે. નવું બેલેન્સ: ₹{bal}"
    },
    "hi": {
        "choose_lang": "कृपया अपनी भाषा चुनें / Please select your language:",
        "lang_set": "भाषा सफलतापूर्वक सेट हो गई है!",
        "menu_buy": "🎟️ टिकट खरीदें",
        "menu_my_tickets": "📋 मेरे टिकट",
        "menu_refer": "🤝 रेफरल लिंक",
        "menu_wallet": "💰 मेरा वॉलेट",
        "menu_prizes": "🏆 पुरस्कार सूची",
        "menu_lang": "🌐 भाषा बदलें",
        "welcome": (
            "👋 लकी ड्रॉ बॉट में आपका स्वागत है!\n\n"
            "🎟️ टिकट मूल्य: ₹50\n"
            "🏆 प्रथम पुरस्कार: ₹1,00,000\n"
            "👥 कुल 2,500 विजेताओं की घोषणा होगी!\n\n"
            "नीचे दिए गए मेनू से विकल्प चुनें।"
        ),
        "limit_reached": "❌ आप पहले ही अधिकतम 10 टिकट खरीद चुके हैं।",
        "sold_out": "❌ सभी 80,000 टिकट बिक चुके हैं! ड्रॉ जल्द ही घोषित होगा।",
        "buy_prompt": (
            "🎟️ **नया टिकट खरीदें**\n\n"
            "आपके खरीदे गए टिकट: {user_count}/10\n"
            "कुल बिके टिकट: {total_sold}/80,000\n\n"
            "{price_text}\n"
            "भुगतान विधि चुनें:"
        ),
        "pay_full_price": "कीमत: ₹50",
        "pay_discount_price": "🎉 50% छूट के साथ कीमत: ₹25 (पहला रेफरल ऑफर!)",
        "btn_pay_gateway": "💳 UPI / Razorpay से भुगतान करें",
        "btn_pay_wallet": "💰 वॉलेट से भुगतान करें",
        "wallet_insufficient": "⚠️ वॉलेट में पर्याप्त बैलेंस नहीं है। आवश्यक: ₹{req}, उपलब्ध: ₹{bal}।",
        "ticket_success": "🎉 बधाई हो! आपका टिकट जनरेट हो गया है।\n\n🎟️ टिकट नंबर: `{ticket_no}`",
        "no_tickets": "आपके पास वर्तमान में कोई मान्य टिकट नहीं है। '🎟️ टिकट खरीदें' पर क्लिक करें।",
        "my_tickets_title": "📋 **आपके खरीदे गए टिकट ({count}/10):**\n\n{list}\n\nℹ️ ड्रॉ 80,000 टिकट पूरे होने पर निकाला जाएगा।",
        "refer_text": (
            "🤝 **रेफर करें और अनलिमिटेड कमाएं!**\n\n"
            "🎁 **पहला रेफरल:** अगली टिकट पर सीधे **50% OFF** (टिकट केवल ₹25 में)!\n"
            "💰 **दूसरे रेफरल से:** हर सफल रेफरल पर **अनलिमिटेड ₹25** आपके वॉलेट में!\n\n"
            "💸 वॉलेट में ₹100 होते ही सीधे UPI/बैंक में ट्रांसफर करें या नया टिकट खरीदें।\n\n"
            "🔗 **आपकी रेफरल लिंक:**\n`{link}`\n\n"
            "👥 सफल रेफरल्स: **{count}** मित्र"
        ),
        "share_whatsapp_btn": "🟢 WhatsApp पर शेयर करें",
        "share_telegram_btn": "✈️ Telegram में शेयर करें",
        "share_caption": (
            "🔥 लकी ड्रॉ में जीतें ₹1 लाख तक के शानदार इनाम! 🏆\n"
            "🎟️ टिकट केवल ₹50 में!\n"
            "🎁 मेरी लिंक से जुड़ें और पहली टिकट पर पाएं 50% OFF!\n"
            "👉 यहाँ क्लिक करें: {link}"
        ),
        "wallet_info": (
            "💰 **आपका वॉलेट बैलेंस:**\n\n"
            "उपलब्ध राशि: **₹{bal}**\n"
            "सफल रेफरल्स: {count}\n\n"
            "ℹ️ न्यूनतम निकासी: ₹100\n"
            "ℹ️ वॉलेट से सीधे टिकट भी खरीद सकते हैं।"
        ),
        "btn_withdraw": "💸 पैसे निकालें (Withdraw)",
        "withdraw_min_err": "⚠️ न्यूनतम निकासी राशि ₹100 है। वर्तमान बैलेंस: ₹{bal}।",
        "ask_upi": "कृपया अपना मान्य UPI ID भेजें (जैसे `mobile@upi` या `name@okhdfcbank`):",
        "withdraw_submitted": "✅ निकासी अनुरोध सफलतापूर्वक सबमिट हो गया है! व्यवस्थापक जल्द ही राशि भेजेंगे।",
        "invalid_upi": "❌ अमान्य UPI ID! कृपया सही UPI ID दोबारा भेजें।",
        "prize_list": (
            "🏆 **लकी ड्रॉ पुरस्कार सूची** 🏆\n\n"
            "🥇 पहला स्थान: ₹1,00,000\n"
            "🥈 2 से 10 स्थान: ₹50,000\n"
            "🥉 11 से 20 स्थान: ₹20,000\n"
            "🎖️ 21 से 50 स्थान: ₹10,000\n"
            "🎖️ 51 से 100 स्थान: ₹5,000\n"
            "🎖️ 101 से 500 स्थान: ₹2,000\n"
            "🎖️ 501 से 1000 स्थान: ₹500\n"
            "🎖️ 1001 से 2500 स्थान: ₹50\n\n"
            "*(कुल 2,500 विजेताओं को 80,000 टिकट पूरे होने पर घोषित किया जाएगा!)*"
        ),
        "ref_notify_discount": "🎉 आपके रेफरल मित्र ने टिकट खरीदा! आपको अगले टिकट पर 50% की छूट मिल गई है।",
        "ref_notify_bonus": "🎉 आपके रेफरल मित्र ने टिकट खरीदा! आपके वॉलेट में ₹25 जोड़े गए हैं। नया बैलेंस: ₹{bal}"
    },
    "en": {
        "choose_lang": "Please select your language / કૃપા કરીને ભાષા પસંદ કરો:",
        "lang_set": "Language set successfully!",
        "menu_buy": "🎟️ Buy Ticket",
        "menu_my_tickets": "📋 My Tickets",
        "menu_refer": "🤝 Referral Link",
        "menu_wallet": "💰 My Wallet",
        "menu_prizes": "🏆 Prize List",
        "menu_lang": "🌐 Change Language",
        "welcome": (
            "👋 Welcome to the Lucky Draw Bot!\n\n"
            "🎟️ Ticket Price: ₹50\n"
            "🏆 First Prize: ₹1,00,000\n"
            "👥 Total 2,500 winners will be announced!\n\n"
            "Select an option from the menu below."
        ),
        "limit_reached": "❌ You have already purchased the maximum limit of 10 tickets.",
        "sold_out": "❌ All 80,000 tickets have been sold out! The draw will be announced soon.",
        "buy_prompt": (
            "🎟️ **Buy New Ticket**\n\n"
            "Your Tickets: {user_count}/10\n"
            "Total Sold: {total_sold}/80,000\n\n"
            "{price_text}\n"
            "Choose Payment Method:"
        ),
        "pay_full_price": "Price: ₹50",
        "pay_discount_price": "🎉 Price with 50% OFF: ₹25 (First Referral Offer!)",
        "btn_pay_gateway": "💳 Pay via UPI / Razorpay",
        "btn_pay_wallet": "💰 Pay from Wallet",
        "wallet_insufficient": "⚠️ Insufficient balance. Required: ₹{req}, Available: ₹{bal}.",
        "ticket_success": "🎉 Congratulations! Your ticket has been generated.\n\n🎟️ Ticket No: `{ticket_no}`",
        "no_tickets": "You do not have any valid tickets yet. Click '🎟️ Buy Ticket'.",
        "my_tickets_title": "📋 **Your Tickets ({count}/10):**\n\n{list}\n\nℹ️ Draw will take place after 80,000 tickets are sold.",
        "refer_text": (
            "🤝 **Refer & Earn Unlimited!**\n\n"
            "🎁 **1st Referral:** Flat **50% OFF** on your next ticket (Get ticket for just ₹25)!\n"
            "💰 **2nd Referral Onwards:** Earn **Unlimited ₹25** in your wallet for every successful referral!\n\n"
            "💸 Withdraw directly via UPI once you reach ₹100 or use it to buy tickets.\n\n"
            "🔗 **Your Referral Link:**\n`{link}`\n\n"
            "👥 Successful Referrals: **{count}** friends"
        ),
        "share_whatsapp_btn": "🟢 Share on WhatsApp",
        "share_telegram_btn": "✈️ Share on Telegram",
        "share_caption": (
            "🔥 Win up to ₹1 Lakh in the Lucky Draw Contest! 🏆\n"
            "🎟️ Ticket only for ₹50!\n"
            "🎁 Join through my link & get 50% OFF on your ticket!\n"
            "👉 Join now: {link}"
        ),
        "wallet_info": (
            "💰 **Your Wallet Balance:**\n\n"
            "Available Balance: **₹{bal}**\n"
            "Successful Referrals: {count}\n\n"
            "ℹ️ Minimum Withdrawal: ₹100\n"
            "ℹ️ You can also buy tickets directly using wallet balance."
        ),
        "btn_withdraw": "💸 Withdraw to UPI",
        "withdraw_min_err": "⚠️ Minimum withdrawal is ₹100. Current balance: ₹{bal}.",
        "ask_upi": "Please send your valid UPI ID (e.g., `mobile@upi` or `name@okhdfcbank`):",
        "withdraw_submitted": "✅ Withdrawal request submitted! Admin will verify and transfer soon.",
        "invalid_upi": "❌ Invalid UPI ID! Please send a valid UPI address.",
        "prize_list": (
            "🏆 **Lucky Draw Prize Structure** 🏆\n\n"
            "🥇 1st Prize: ₹1,00,000\n"
            "🥈 2nd to 10th: ₹50,000\n"
            "🥉 11th to 20th: ₹20,000\n"
            "🎖️ 21st to 50th: ₹10,000\n"
            "🎖️ 51st to 100th: ₹5,000\n"
            "🎖️ 101st to 500th: ₹2,000\n"
            "🎖️ 501st to 1000th: ₹500\n"
            "🎖️ 1001st to 2500th: ₹50\n\n"
            "*(Total 2,500 Winners will be announced after 80,000 tickets are sold!)*"
        ),
        "ref_notify_discount": "🎉 Your referred friend bought a ticket! You unlocked 50% OFF on your next ticket.",
        "ref_notify_bonus": "🎉 Your referred friend bought a ticket! ₹25 has been credited to your wallet. New balance: ₹{bal}"
    }
}

# ==========================================
# ૩. ડેટાબેઝ સેટઅપ (MONGODB LOGIC)
# ==========================================
mongo_client = MongoClient(MONGO_URI)
db = mongo_client[DB_NAME]
users_col = db["users"]
tickets_col = db["tickets"]
withdrawals_col = db["withdrawals"]

users_col.create_index("telegram_id", unique=True)
tickets_col.create_index("ticket_no", unique=True)
tickets_col.create_index("payment_id", unique=True, sparse=True)

def get_or_create_user(telegram_id, username="", first_name="", referred_by=None):
    user = users_col.find_one({"telegram_id": telegram_id})
    if not user:
        valid_ref = referred_by if (referred_by and referred_by != telegram_id) else None
        user_data = {
            "telegram_id": telegram_id,
            "username": username,
            "first_name": first_name,
            "language": "gu",
            "referred_by": valid_ref,
            "successful_referrals_count": 0,
            "has_first_referral_discount": False,
            "wallet_balance": 0.0,
            "joined_at": datetime.now(timezone.utc)
        }
        users_col.insert_one(user_data)
        return user_data
    return user

def set_user_language(telegram_id, lang_code):
    users_col.update_one({"telegram_id": telegram_id}, {"$set": {"language": lang_code}})

def get_user_language(telegram_id):
    user = users_col.find_one({"telegram_id": telegram_id})
    return user.get("language", "gu") if user else "gu"

def get_total_tickets_count():
    return tickets_col.count_documents({})

def get_user_tickets(telegram_id):
    return list(tickets_col.find({"telegram_id": telegram_id}))

def generate_ticket_number():
    while True:
        num = f"TK-{random.randint(100000, 999999)}"
        if not tickets_col.find_one({"ticket_no": num}):
            return num

def issue_ticket(telegram_id, amount_paid, payment_id="WALLET"):
    t_no = generate_ticket_number()
    ticket_doc = {
        "ticket_no": t_no,
        "telegram_id": telegram_id,
        "amount": amount_paid,
        "payment_id": payment_id,
        "created_at": datetime.now(timezone.utc)
    }
    tickets_col.insert_one(ticket_doc)

    user = users_col.find_one({"telegram_id": telegram_id})
    if user and user.get("has_first_referral_discount") and amount_paid == DISCOUNTED_PRICE:
        users_col.update_one({"telegram_id": telegram_id}, {"$set": {"has_first_referral_discount": False}})

    # પ્રથમ ટિકિટ ખરીદી પર રેફરરને રિવોર્ડ આપવો
    user_tickets_count = tickets_col.count_documents({"telegram_id": telegram_id})
    ref_id = user.get("referred_by")
    
    referrer_reward_info = None
    if user_tickets_count == 1 and ref_id:
        referrer = users_col.find_one({"telegram_id": ref_id})
        if referrer:
            s_count = referrer.get("successful_referrals_count", 0)
            if s_count == 0:
                users_col.update_one(
                    {"telegram_id": ref_id},
                    {
                        "$set": {"has_first_referral_discount": True},
                        "$inc": {"successful_referrals_count": 1}
                    }
                )
                referrer_reward_info = {"ref_id": ref_id, "type": "discount"}
            else:
                users_col.update_one(
                    {"telegram_id": ref_id},
                    {
                        "$inc": {
                            "wallet_balance": float(REFERRAL_BONUS),
                            "successful_referrals_count": 1
                        }
                    }
                )
                updated_ref = users_col.find_one({"telegram_id": ref_id})
                referrer_reward_info = {
                    "ref_id": ref_id,
                    "type": "bonus",
                    "bal": updated_ref.get("wallet_balance", 0.0)
                }

    return t_no, referrer_reward_info

def deduct_wallet_for_ticket(telegram_id, amount):
    res = users_col.update_one(
        {"telegram_id": telegram_id, "wallet_balance": {"$gte": float(amount)}},
        {"$inc": {"wallet_balance": -float(amount)}}
    )
    return res.modified_count > 0

def create_withdrawal(telegram_id, amount, upi_id):
    res = users_col.update_one(
        {"telegram_id": telegram_id, "wallet_balance": {"$gte": float(amount)}},
        {"$inc": {"wallet_balance": -float(amount)}}
    )
    if res.modified_count > 0:
        req_id = f"WD-{random.randint(10000, 99999)}"
        withdrawals_col.insert_one({
            "request_id": req_id,
            "telegram_id": telegram_id,
            "amount": amount,
            "upi_id": upi_id,
            "status": "pending",
            "created_at": datetime.now(timezone.utc)
        })
        return req_id
    return None

# ==========================================
# ૪. રેઝરપે પેમેન્ટ્સ (RAZORPAY GATEWAY)
# ==========================================
rzp_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

def create_payment_link(telegram_id, amount_in_rupees, user_name="Participant"):
    payload = {
        "amount": amount_in_rupees * 100,
        "currency": "INR",
        "accept_partial": False,
        "description": "Contest Entry Ticket",
        "customer": {"name": user_name},
        "notify": {"sms": False, "email": False},
        "reminder_enable": False,
        "notes": {
            "telegram_id": str(telegram_id),
            "amount_paid": str(amount_in_rupees)
        }
    }
    link_data = rzp_client.payment_link.create(payload)
    return link_data.get("short_url")

def verify_webhook_signature(body_bytes, signature_header):
    if not RAZORPAY_WEBHOOK_SECRET:
        return False
    expected = hmac.new(
        key=RAZORPAY_WEBHOOK_SECRET.encode('utf-8'),
        msg=body_bytes,
        digestmod=hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)

# ==========================================
# ૫. ટેલિગ્રામ બોટ લોજિક (BOT HANDLERS)
# ==========================================
bot = telebot.TeleBot(BOT_TOKEN, threaded=False)
user_states = {}

def notify_referrer_if_any(ref_reward):
    if not ref_reward:
        return
    ref_id = ref_reward["ref_id"]
    r_lang = get_user_language(ref_id)
    rm = MESSAGES[r_lang]
    try:
        if ref_reward["type"] == "discount":
            bot.send_message(ref_id, rm["ref_notify_discount"])
        elif ref_reward["type"] == "bonus":
            bot.send_message(ref_id, rm["ref_notify_bonus"].format(bal=ref_reward["bal"]))
    except Exception:
        pass

def get_main_keyboard(lang):
    m = MESSAGES[lang]
    kb = ReplyKeyboardMarkup(resize_keyboard=True, row_width=2)
    kb.add(KeyboardButton(m["menu_buy"]))
    kb.add(KeyboardButton(m["menu_my_tickets"]), KeyboardButton(m["menu_prizes"]))
    kb.add(KeyboardButton(m["menu_refer"]), KeyboardButton(m["menu_wallet"]))
    kb.add(KeyboardButton(m["menu_lang"]))
    return kb

@bot.message_handler(commands=['start'])
def handle_start(message):
    args = message.text.split()
    referred_by = None
    if len(args) > 1 and args[1].startswith("ref_"):
        try:
            referred_by = int(args[1].replace("ref_", ""))
        except ValueError:
            referred_by = None

    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username or "",
        first_name=message.from_user.first_name or "",
        referred_by=referred_by
    )

    markup = InlineKeyboardMarkup(row_width=3)
    markup.add(
        InlineKeyboardButton("🇬🇺 ગુજરાતી", callback_data="lang_gu"),
        InlineKeyboardButton("🇮🇳 हिंदी", callback_data="lang_hi"),
        InlineKeyboardButton("🇬🇧 English", callback_data="lang_en")
    )
    bot.send_message(message.chat.id, MESSAGES["gu"]["choose_lang"], reply_markup=markup)

@bot.callback_query_handler(func=lambda c: c.data.startswith("lang_"))
def handle_lang_selection(call):
    lang = call.data.split("_")[1]
    set_user_language(call.from_user.id, lang)
    bot.answer_callback_query(call.id, MESSAGES[lang]["lang_set"])
    bot.send_message(
        call.message.chat.id,
        MESSAGES[lang]["welcome"],
        reply_markup=get_main_keyboard(lang)
    )

@bot.message_handler(commands=['language'])
def handle_lang_cmd(message):
    markup = InlineKeyboardMarkup(row_width=3)
    markup.add(
        InlineKeyboardButton("🇬🇺 ગુજરાતી", callback_data="lang_gu"),
        InlineKeyboardButton("🇮🇳 हिंदी", callback_data="lang_hi"),
        InlineKeyboardButton("🇬🇧 English", callback_data="lang_en")
    )
    bot.send_message(message.chat.id, "Select your language / ભાષા પસંદ કરો:", reply_markup=markup)

@bot.message_handler(func=lambda msg: True)
def handle_all_messages(message):
    t_id = message.from_user.id
    user = get_or_create_user(t_id)
    lang = user.get("language", "gu")
    m = MESSAGES[lang]
    text = message.text.strip()

    # ટિકિટ ખરીદો
    if text in [m["menu_buy"], "🎟️ ટિકિટ ખરીદો", "🎟️ टिकट खरीदें", "🎟️ Buy Ticket"]:
        total_sold = get_total_tickets_count()
        if total_sold >= TOTAL_TICKETS_LIMIT:
            bot.send_message(message.chat.id, m["sold_out"])
            return

        user_tickets = get_user_tickets(t_id)
        if len(user_tickets) >= MAX_TICKETS_PER_USER:
            bot.send_message(message.chat.id, m["limit_reached"])
            return

        has_disc = user.get("has_first_referral_discount", False)
        cost = DISCOUNTED_PRICE if has_disc else REGULAR_PRICE
        cost_text = m["pay_discount_price"] if has_disc else m["pay_full_price"]

        markup = InlineKeyboardMarkup(row_width=1)
        markup.add(InlineKeyboardButton(m["btn_pay_gateway"], callback_data=f"buy_gw_{cost}"))
        if user.get("wallet_balance", 0.0) >= cost:
            markup.add(InlineKeyboardButton(f"{m['btn_pay_wallet']} (₹{cost})", callback_data=f"buy_wal_{cost}"))

        prompt = m["buy_prompt"].format(
            user_count=len(user_tickets),
            total_sold=total_sold,
            price_text=cost_text
        )
        bot.send_message(message.chat.id, prompt, parse_mode="Markdown", reply_markup=markup)

    # મારી ટિકિટો
    elif text in [m["menu_my_tickets"], "📋 મારી ટિકિટો", "📋 मेरे टिकट", "📋 My Tickets"]:
        u_tickets = get_user_tickets(t_id)
        if not u_tickets:
            bot.send_message(message.chat.id, m["no_tickets"])
            return
        t_list = "\n".join([f"• `{t['ticket_no']}`" for t in u_tickets])
        bot.send_message(
            message.chat.id,
            m["my_tickets_title"].format(count=len(u_tickets), list=t_list),
            parse_mode="Markdown"
        )

    # રેફરલ લિંક & ૧-ક્લિક સોશિયલ શેરિંગ
    elif text in [m["menu_refer"], "🤝 રેફરલ લિંક", "🤝 रेफरल लिंक", "🤝 Referral Link"]:
        ref_link = f"https://t.me/{BOT_USERNAME}?start=ref_{t_id}"
        caption = m["share_caption"].format(link=ref_link)
        encoded_caption = urllib.parse.quote(caption)
        encoded_link = urllib.parse.quote(ref_link)

        wa_url = f"https://api.whatsapp.com/send?text={encoded_caption}"
        tg_url = f"https://t.me/share/url?url={encoded_link}&text={encoded_caption}"

        markup = InlineKeyboardMarkup(row_width=2)
        markup.add(
            InlineKeyboardButton(m["share_whatsapp_btn"], url=wa_url),
            InlineKeyboardButton(m["share_telegram_btn"], url=tg_url)
        )

        msg_body = m["refer_text"].format(link=ref_link, count=user.get("successful_referrals_count", 0))
        bot.send_message(message.chat.id, msg_body, parse_mode="Markdown", reply_markup=markup)

    # વોલેટ
    elif text in [m["menu_wallet"], "💰 મારું વોલેટ", "💰 मेरा वॉलेट", "💰 My Wallet"]:
        bal = user.get("wallet_balance", 0.0)
        markup = InlineKeyboardMarkup(row_width=1)
        markup.add(InlineKeyboardButton(m["btn_withdraw"], callback_data="req_withdraw"))

        msg_body = m["wallet_info"].format(bal=bal, count=user.get("successful_referrals_count", 0))
        bot.send_message(message.chat.id, msg_body, parse_mode="Markdown", reply_markup=markup)

    # ઇનામ સૂચિ
    elif text in [m["menu_prizes"], "🏆 ઇનામ સૂચિ", "🏆 पुरस्कार सूची", "🏆 Prize List"]:
        bot.send_message(message.chat.id, m["prize_list"])

    # ભાષા બદલો
    elif text in [m["menu_lang"], "🌐 ભાષા બદલો", "🌐 भाषा बदलें", "🌐 Change Language"]:
        handle_lang_cmd(message)

    # વિથડ્રોઅલ UPI ઇનપુટ
    elif user_states.get(t_id) == "waiting_upi":
        upi = text.strip()
        if "@" not in upi or len(upi) < 5:
            bot.send_message(message.chat.id, m["invalid_upi"])
            return

        bal = user.get("wallet_balance", 0.0)
        if bal < MIN_WITHDRAWAL:
            bot.send_message(message.chat.id, m["withdraw_min_err"].format(bal=bal))
            user_states.pop(t_id, None)
            return

        req_id = create_withdrawal(t_id, bal, upi)
        user_states.pop(t_id, None)
        if req_id:
            bot.send_message(message.chat.id, m["withdraw_submitted"])
            admin_msg = (
                f"🔔 **નવી વિથડ્રોઅલ વિનંતી!**\n\n"
                f"Request ID: `{req_id}`\n"
                f"User ID: `{t_id}` (@{user.get('username', 'N/A')})\n"
                f"Amount: ₹{bal}\n"
                f"UPI ID: `{upi}`"
            )
            bot.send_message(ADMIN_ID, admin_msg, parse_mode="Markdown")

@bot.callback_query_handler(func=lambda c: c.data.startswith(("buy_gw_", "buy_wal_", "req_withdraw")))
def handle_ticket_callbacks(call):
    t_id = call.from_user.id
    user = get_or_create_user(t_id)
    lang = user.get("language", "gu")
    m = MESSAGES[lang]

    if call.data.startswith("buy_gw_"):
        cost = int(call.data.split("_")[2])
        link = create_payment_link(t_id, cost, call.from_user.first_name or "Participant")
        markup = InlineKeyboardMarkup()
        markup.add(InlineKeyboardButton(f"💳 Pay ₹{cost} Now", url=link))
        bot.send_message(call.message.chat.id, f"👇 નીચે આપેલ લિંક પર ક્લિક કરી પેમેન્ટ પૂર્ણ કરો:", reply_markup=markup)
        bot.answer_callback_query(call.id)

    elif call.data.startswith("buy_wal_"):
        cost = int(call.data.split("_")[2])
        if deduct_wallet_for_ticket(t_id, cost):
            t_no, ref_reward = issue_ticket(t_id, cost, "WALLET")
            bot.send_message(call.message.chat.id, m["ticket_success"].format(ticket_no=t_no), parse_mode="Markdown")
            notify_referrer_if_any(ref_reward)
        else:
            bot.send_message(call.message.chat.id, m["wallet_insufficient"].format(req=cost, bal=user.get("wallet_balance", 0.0)))
        bot.answer_callback_query(call.id)

    elif call.data == "req_withdraw":
        bal = user.get("wallet_balance", 0.0)
        if bal < MIN_WITHDRAWAL:
            bot.answer_callback_query(call.id, m["withdraw_min_err"].format(bal=bal), show_alert=True)
            return
        user_states[t_id] = "waiting_upi"
        bot.send_message(call.message.chat.id, m["ask_upi"], parse_mode="Markdown")
        bot.answer_callback_query(call.id)

# ==========================================
# ૬. FLASK વેબ સર્વર & WEBHOOKS
# ==========================================
app = Flask(__name__)

@app.route("/", methods=["GET"])
def health_check():
    return jsonify({"status": "running", "service": "Single-File Lottery Engine"}), 200

@app.route(f"/webhook/{BOT_TOKEN}", methods=["POST"])
def telegram_webhook():
    if request.headers.get("content-type") == "application/json":
        json_string = request.get_data().decode("utf-8")
        update = telebot.types.Update.de_json(json_string)
        bot.process_new_updates([update])
        return "", 200
    return "Forbidden", 403

@app.route("/razorpay-webhook", methods=["POST"])
def razorpay_webhook():
    signature = request.headers.get("X-Razorpay-Signature", "")
    data_bytes = request.data

    if not verify_webhook_signature(data_bytes, signature):
        return jsonify({"status": "invalid signature"}), 400

    payload = request.json
    event = payload.get("event")

    if event in ["payment_link.paid", "payment.captured"]:
        entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
        if not entity:
            entity = payload.get("payload", {}).get("payment_link", {}).get("entity", {})

        notes = entity.get("notes", {})
        t_id_str = notes.get("telegram_id")
        amount_str = notes.get("amount_paid", "50")
        payment_id = entity.get("id")

        if t_id_str and payment_id:
            t_id = int(t_id_str)
            cost = int(amount_str)

            t_no, ref_reward = issue_ticket(t_id, cost, payment_id)

            lang = get_user_language(t_id)
            success_msg = MESSAGES[lang]["ticket_success"].format(ticket_no=t_no)
            try:
                bot.send_message(t_id, success_msg, parse_mode="Markdown")
            except Exception:
                pass

            notify_referrer_if_any(ref_reward)

    return jsonify({"status": "success"}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
