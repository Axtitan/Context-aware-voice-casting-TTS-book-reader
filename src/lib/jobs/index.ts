import { bootQueue, registerHandler, enqueue } from "./queue";
import { analyzeBook } from "./analyze";
import { generateAudio } from "./generate";

registerHandler("analyze_book", analyzeBook);
registerHandler("generate_audio", generateAudio);
void bootQueue();

export { enqueue };
