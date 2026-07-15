import https from 'https';
import fs from 'fs';

const url = 'https://upload.wikimedia.org/wikipedia/commons/b/b9/Balangay_boat_at_sunset.jpg';
const dest = './public/hero-bg.jpg';

const options = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
};

https.get(url, options, (response) => {
  if (response.statusCode !== 200) {
    console.error(`Failed to get '${url}' (${response.statusCode})`);
    return;
  }
  const file = fs.createWriteStream(dest);
  response.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('Download complete.');
  });
}).on('error', (err) => {
  console.error(err);
});


