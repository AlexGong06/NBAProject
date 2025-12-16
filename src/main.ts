import logger from "./utils/logger";
import { main } from "./web-automation";

void main()
  .then(() => {
    process.exit();
  })
  .catch((err) => {
    logger.error(err);
    process.exit(1);
  });
