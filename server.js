const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Increase request limit for base64 image uploads
app.use(express.json({ limit: '12mb' }));

// Schemas for Gemini Structured JSON Outputs
let Type;
try {
  const genai = require('@google/genai');
  Type = genai.Type;
} catch (e) {
  console.warn('Type from @google/genai could not be loaded statically, will load dynamically if needed.');
}

const mealGeneratorSchema = {
  type: 'OBJECT',
  properties: {
    targetCalories: { type: 'INTEGER' },
    bmr: { type: 'INTEGER' },
    tdee: { type: 'INTEGER' },
    totals: {
      type: 'OBJECT',
      properties: {
        calories: { type: 'INTEGER' },
        protein: { type: 'INTEGER' },
        carbs: { type: 'INTEGER' },
        fat: { type: 'INTEGER' },
        cost: { type: 'INTEGER' }
      },
      required: ['calories', 'protein', 'carbs', 'fat', 'cost']
    },
    meals: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          slot: { type: 'STRING' },
          category: { type: 'STRING' },
          time: { type: 'INTEGER' },
          desc: { type: 'STRING' },
          img: { type: 'STRING' },
          calories: { type: 'INTEGER' },
          protein: { type: 'INTEGER' },
          carbs: { type: 'INTEGER' },
          fat: { type: 'INTEGER' },
          cost: { type: 'INTEGER' },
          ingredients: {
            type: 'ARRAY',
            items: { type: 'STRING' }
          },
          instructions: { type: 'STRING' }
        },
        required: ['name', 'slot', 'category', 'time', 'desc', 'img', 'calories', 'protein', 'carbs', 'fat', 'cost', 'ingredients', 'instructions']
      }
    }
  },
  required: ['targetCalories', 'bmr', 'tdee', 'totals', 'meals']
};

const nutriScanSchema = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    calories: { type: 'INTEGER' },
    protein: { type: 'INTEGER' },
    carbs: { type: 'INTEGER' },
    fat: { type: 'INTEGER' },
    score: { type: 'INTEGER' },
    tip: { type: 'STRING' }
  },
  required: ['name', 'calories', 'protein', 'carbs', 'fat', 'score', 'tip']
};

// --- API Endpoints ---

// API Route for AI Meal Generator
app.post('/api/meal-generator', async (req, res) => {
  const profile = req.body;
  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY is not defined. Falling back to client local generation.');
    return res.status(200).json({ fallback: true });
  }

  try {
    const { GoogleGenAI, Type: GType } = require('@google/genai');
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const prompt = `Generate a highly personalized daily Kenyan meal plan (breakfast, lunch, and dinner) for a user with the following profile:
- Age: ${profile.age} years old
- Gender: ${profile.gender}
- Weight: ${profile.weight} kg
- Height: ${profile.height} cm
- Physical activity level: ${profile.activity || 'sedentary'}
- Health conditions: ${profile.condition || 'none'}
- Dietary preferences: ${profile.diet || 'any'}
- Fitness goal: ${profile.goal || 'maintain'}

Please use realistic estimations for target calories, BMR, and TDEE based on their profile.
Each meal (breakfast, lunch, dinner) should be a traditional or common Kenyan dish.
For the 'img' property of each meal, you must select the most appropriate image URL from this exact list of high-quality Unsplash food photos:
- Ugali, Sukuma Wiki & Omena: 'https://images.unsplash.com/photo-1604329760661-e71dc83f8f26?q=80&w=600&auto=format&fit=crop'
- Githeri with Avocado: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=600&auto=format&fit=crop'
- Mukimo with Beef Stew: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?q=80&w=600&auto=format&fit=crop'
- Pilau with Kachumbari: 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?q=80&w=600&auto=format&fit=crop'
- Nyama Choma with Kachumbari: 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?q=80&w=600&auto=format&fit=crop'
- Tilapia in Coconut Sauce with Rice: 'https://images.unsplash.com/photo-1626508035297-0cd27c5375a8?q=80&w=600&auto=format&fit=crop'
- Ndengu (Green Gram) Stew with Chapati: 'https://images.unsplash.com/photo-1599490659213-e0b79d3a8c10?q=80&w=600&auto=format&fit=crop'
- Matoke with Groundnut Sauce: 'https://images.unsplash.com/photo-1604908176997-4316c9c6c8f3?q=80&w=600&auto=format&fit=crop'
- Chapati with Beef and Vegetable Stir-fry: 'https://images.unsplash.com/photo-1574653853027-5d3ac9b9a6e7?q=80&w=600&auto=format&fit=crop'
- Omena with Ugali and Managu: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?q=80&w=600&auto=format&fit=crop'
- Arrowroots with Tea and Groundnuts: 'https://images.unsplash.com/photo-1623238913973-21e2243c3e98?q=80&w=600&auto=format&fit=crop'

Ensure that all calculations (calories, macronutrients, costs in KES) are mathematically consistent and total calories matches the sum of breakfast, lunch, and dinner.`;

    // Map string schemas to exact Type enum objects dynamically
    const mapSchemaTypes = (schema) => {
      const copy = { ...schema };
      if (copy.type && typeof copy.type === 'string') {
        copy.type = GType[copy.type];
      }
      if (copy.properties) {
        const props = {};
        for (const [key, val] of Object.entries(copy.properties)) {
          props[key] = mapSchemaTypes(val);
        }
        copy.properties = props;
      }
      if (copy.items) {
        copy.items = mapSchemaTypes(copy.items);
      }
      return copy;
    };

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: mapSchemaTypes(mealGeneratorSchema)
      }
    });

    const result = JSON.parse(response.text);
    return res.json(result);
  } catch (error) {
    console.error('Error generating meal plan with Gemini:', error);
    return res.status(200).json({ fallback: true, error: error.message });
  }
});

// API Route for NutriScan
app.post('/api/nutriscan', async (req, res) => {
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'Image data is required.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY is not defined. Falling back to mock scan.');
    return res.status(200).json({ fallback: true });
  }

  try {
    const { GoogleGenAI, Type: GType } = require('@google/genai');
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    // Remove base64 metadata prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    const imagePart = {
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64Data
      }
    };

    const textPart = {
      text: `Analyze this food plate photo of a Kenyan meal. Identify what dishes are present, estimate portion sizes, calculate the estimated nutritional content, and provide a health score from 0 to 100 with a helpful, actionable dietary tip tailored for a Kenyan household.`
    };

    const mapSchemaTypes = (schema) => {
      const copy = { ...schema };
      if (copy.type && typeof copy.type === 'string') {
        copy.type = GType[copy.type];
      }
      if (copy.properties) {
        const props = {};
        for (const [key, val] of Object.entries(copy.properties)) {
          props[key] = mapSchemaTypes(val);
        }
        copy.properties = props;
      }
      return copy;
    };

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: { parts: [imagePart, textPart] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: mapSchemaTypes(nutriScanSchema)
      }
    });

    const result = JSON.parse(response.text);
    return res.json(result);
  } catch (error) {
    console.error('Error analyzing image with Gemini:', error);
    return res.status(200).json({ fallback: true, error: error.message });
  }
});

// API Route for AI Chatbot
app.post('/api/chatbot', async (req, res) => {
  const { message, history } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY is not defined. Falling back to local replies.');
    return res.status(200).json({ fallback: true });
  }

  try {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const contents = [];
    if (history && Array.isArray(history)) {
      history.slice(-10).forEach(item => {
        contents.push({
          role: item.role === 'user' ? 'user' : 'model',
          parts: [{ text: item.text }]
        });
      });
    }
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: contents,
      config: {
        systemInstruction: "You are an expert certified Kenyan nutritionist and Smart Lishe assistant. You have deep knowledge of traditional Kenyan foods (such as ugali, sukuma wiki, managu, terere, githeri, mukimo, matoke, ndengu, omena, tilapia, nyama choma, chapati, arrowroots, sweet potatoes, uji). Provide practical, encouraging, and science-backed nutritional advice that is affordable and culturally relevant to Kenyan tables. Keep your replies concise (under 120 words) and friendly."
      }
    });

    return res.json({ text: response.text });
  } catch (error) {
    console.error('Error with chatbot Gemini API:', error);
    return res.status(200).json({ fallback: true, error: error.message });
  }
});

// Serve static files from /smart-meal-plan-generator-main/FRONTEND
app.use(express.static(path.join(__dirname, 'smart-meal-plan-generator-main', 'FRONTEND')));

// Redirect the root to /user/home.html
app.get('/', (req, res) => {
  res.redirect('/user/home.html');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

