"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = void 0;
const playwright_1 = require("playwright");
const wait_1 = require("./wait");
const mongodb_1 = require("mongodb");
//import * as fs from 'fs';
async function main() {
    /**
     * Flow of program:
     */
    const browser = playwright_1.chromium.launch({ headless: false });
    const page = await new Promise((resolve) => {
        browser.then(async (browser) => {
            resolve(await browser.newPage());
        });
    });
    await page.goto("https://www.basketball-reference.com/");
    await (0, wait_1.wait)(2000);
    await page.click("[id='header_leaders']");
    await (0, wait_1.wait)(5000);
    const data = await page.evaluate(() => {
        const playerData = [];
        var Nbaleaders = document.querySelectorAll("[class='tabular_row']");
        for (let i = 0; i < Nbaleaders.length; i++) {
            var players = Nbaleaders[i];
            var subject = players.innerText;
            var subjectFinal = subject.split('\n')[0];
            var playerName = players.innerText;
            var playerNameFinal = playerName.substring(playerName.indexOf("\n") + 1);
            playerData.push({ Subject: subjectFinal, Player: playerNameFinal });
        }
        return playerData;
    });
    console.log(data);
    await (0, wait_1.wait)(5000);
    const uri = 'mongodb://localhost:8000/compassionate_gagarin';
    const client = new mongodb_1.MongoClient(uri);
    async function connectToDatabase() {
        try {
            await client.connect();
            console.log('Connected to MongoDB');
        }
        catch (err) {
            console.error('Error connecting to MongoDB:', err);
        }
    }
    await connectToDatabase();
    await (0, wait_1.wait)(5000);
    for (let i = 0; i < data.length; i++) {
        const db = client.db('NbaDb');
        const collection = db.collection('DailyStatsLeaders');
        const date = new Date();
        const year = date.getFullYear();
        const month = date.getMonth() + 1; // Months are zero-based (0 = January)
        const day = date.getDate();
        const fullDate = month + '-' + day + '-' + year;
        const scrapedData = {
            Statistic: data[i].Subject,
            Player: data[i].Player,
            date: fullDate
        };
        try {
            const result = await collection.insertOne(scrapedData);
            console.log('Inserted ' + data[i].Subject + ' into MongoDB on ' + fullDate + '.');
        }
        catch (err) {
            console.error('Error inserting entry into MongoDB:', err);
        }
    }
    /*const db = client.db('NbaDb');
    const collection = db.collection('yourCollectionName');
  
    const scrapedData = {
      name: "Steph Curry",
      age: 35,
      email: "nightnight@example.com"
    };
  
    try {
        const result = await collection.insertOne(scrapedData);
        console.log(`Inserted 1 entry into MongoDB.`);
    } catch (err) {
      console.error('Error inserting entry into MongoDB:', err);
    }*/
}
exports.main = main;
