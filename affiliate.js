
import express from 'express';
import axios from 'axios';
import { config } from 'dotenv';
import { OpenAI } from 'openai';
import { chromium } from 'playwright';

config();

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// GPT-4o call with function call for affiliate link
app.post('/process-comment', async (req, res) => {
  const { text, image, audio, video } = req.body;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an affiliate assistant. Read a user comment, extract product intent, and request the best affiliate link using a function call.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: text },
            ...(image ? [{ type: 'image_url', image_url: { url: image } }] : []),
            ...(audio ? [{ type: 'audio_url', audio_url: { url: audio } }] : []),
            ...(video ? [{ type: 'video_url', video_url: { url: video } }] : [])
          ]
        }
      ],
      functions: [
        {
          name: 'searchAffiliateLink',
          description: 'Find relevant affiliate link for a product query.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Product to search affiliate link for'
              }
            },
            required: ['query']
          }
        }
      ],
      function_call: 'auto'
    });

    const toolCall = completion.choices[0].message.function_call;
    const query = JSON.parse(toolCall.arguments).query;

    // Search affiliate link
    const affiliateUrl = await searchAffiliateLink(query);

    // Send reply request to OpenAI with affiliate link
    const finalReply = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Create a friendly reply embedding the affiliate link.' },
        { role: 'user', content: `Original comment: ${text}\nAffiliate URL: ${affiliateUrl}` }
      ]
    });

    const replyText = finalReply.choices[0].message.content;

    // Auto-post to Reddit using Playwright
    const postResult = await autoReplyReddit(text, replyText);

    res.json({ success: true, replyText, affiliateUrl, postResult });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Simulated Affiliate Link Search
async function searchAffiliateLink(query) {
  try {
    const result = await axios.get(`https://api.short.io/links?search=${encodeURIComponent(query)}`, {
      headers: {
        authorization: process.env.SHORTIO_API_KEY
      }
    });
    return result.data[0]?.shortURL || 'https://fallback-affiliate-link.com';
  } catch (e) {
    return 'https://fallback-affiliate-link.com';
  }
}

// Post a reply on Reddit using Playwright
async function autoReplyReddit(commentText, replyText) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('https://www.reddit.com/login');
    await page.fill('#loginUsername', process.env.REDDIT_USERNAME);
    await page.fill('#loginPassword', process.env.REDDIT_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Navigate to the thread or locate recent comment
    await page.goto(process.env.REDDIT_THREAD_URL);
    await page.waitForSelector('textarea');
    await page.click('textarea');
    await page.fill('textarea', replyText);
    await page.click('button:has-text("Comment")');
    await browser.close();

    return 'Comment posted';
  } catch (e) {
    await browser.close();
    return 'Failed to post: ' + e.message;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
