module.exports = {
    apps: [
        {
            name: "ahkrot8 whitemarket", // The name of your app in PM2
            script: "index.ts", // The entry script file
            interpreter: "deno", // Use "deno" as the interpreter
            interpreter_args: "run -A" // Arguments for the Deno command
        }
    ]
};
