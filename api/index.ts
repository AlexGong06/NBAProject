import express from "express";
import dailyRankingsRouter from "./routes/players";

const app = express();
console.log("running server");
app.use(express.json());

// register your router
app.use("/api", dailyRankingsRouter);

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
