import { MongoClient } from 'mongodb';

export async function saveToMongo(data: any[]) {
  const uri = 'mongodb+srv://alex_db_user:sCmRATaxkJipdruw@nba-stats-leaders.kdgfez3.mongodb.net/?appName=NBA-Stats-Leaders';
  const client = new MongoClient(uri);

  try {
    // Connect to database
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('NbaDb');
    const collection = db.collection('DailyStatsLeaders');

    // Compute date string for reference
    const date = new Date();
    const fullDate = `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`;

    // Iterate through each statistical category
    for (const category of data) {
      const document = {
        date: fullDate,
        statistic: category.Subject,        // e.g. 'Points', 'Assists', etc.
        leaders: category.Players.map(p => ({
          rank: p.rank ?? p.Rank ?? null,
          player: p.player ?? p.Player ?? null,
          team: p.team ?? p.Team ?? null,
          value: p.value ?? p.Value ?? null
        }))
      };

      // Insert the category record into MongoDB
      try {
        const result = await collection.insertOne(document);
        console.log(`📊 Inserted ${category.Subject} leaders for ${fullDate}`);
      } catch (err) {
        console.error(`❌ Error inserting ${category.Subject}:`, err);
      }
    }
  } catch (err) {
    console.error('🚨 Error connecting to MongoDB:', err);
  } finally {
    await client.close();
    console.log('🔒 MongoDB connection closed');
  }
}
