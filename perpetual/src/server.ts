import express from "express";
import orderRouter from "./routes/order";
import closeRouter from "./routes/close";
import marketsRouter from "./routes/markets";
import usersRouter from "./routes/users";
import depositRouter from "./routes/deposit";

const app = express();
app.use(express.json());

app.use("/order", orderRouter);
app.use("/close", closeRouter);
app.use("/markets", marketsRouter);
app.use("/users", usersRouter);
app.use("/deposit", depositRouter);

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
