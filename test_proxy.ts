
import fetch from 'node-fetch';

const token = 'rz-3fhey5djuhvck1cdqiqvqf';
const url = 'http://localhost:3000/v1/chat/completions';

async function test() {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-thinking',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true // intentionally try stream
      })
    });

    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Body:', text);
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
