'use strict';

// Get logger instance
const logger = global.logger ? global.logger.getLogger('Joke') : console;

const fs = require('fs');
const path = require('path');

class JokeGame {
    constructor() {
        this.gameName = 'Joke of the Day';
        this.gameCommands = ['j', 'joke', 'jotd'];
        this.jokes = [];
        this.loadJokes();
    }

    loadJokes() {
        const possiblePaths = [
            path.join(__dirname, 'data', 'jokes.txt'),
            path.join(process.cwd(), 'src', 'bbs', 'data', 'jokes.txt'),
            path.join(process.cwd(), 'data', 'jokes.txt'),
        ];

        for (const jokesPath of possiblePaths) {
            try {
                if (!fs.existsSync(jokesPath)) continue;
                const jokesData = fs.readFileSync(jokesPath, 'utf8');
                this.jokes = jokesData.split('\n')
                    .map(joke => joke.trim())
                    .filter(joke => joke.length > 0);
                if (this.jokes.length > 0) {
                    logger.log(`[Joke Game] Loaded ${this.jokes.length} jokes from ${jokesPath}`);
                    return;
                }
            } catch (error) {
                logger.error(`[Joke Game] Failed to load jokes from ${jokesPath}:`, error);
            }
        }

        logger.error('[Joke Game] jokes.txt not found in any expected location');
        this.jokes = [];
    }

    startGame(sessionKey, gameStates, getGamesMenu, setGamesMenuState) {
        // Reset menu state back to games immediately
        setGamesMenuState();

        if (!this.jokes || this.jokes.length === 0) {
            return `\r\nJoke of the Day is currently unavailable (jokes file not found).\r\n` +
                   `\r\n` + getGamesMenu();
        }

        try {
            // Get a joke based on the current date (same joke for the whole day)
            const today = new Date();
            const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
            const jokeIndex = dayOfYear % this.jokes.length;
            const todaysJoke = this.jokes[jokeIndex];

            // Format the date nicely
            const dateStr = today.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            return `\r\n=== JOKE OF THE DAY ===\r\n` +
                   `\r\n` +
                   `${dateStr}\r\n` +
                   `\r\n` +
                   `${todaysJoke}\r\n` +
                   `\r\n` +
                   `Hope that brought a smile to your face!\r\n` +
                   `\r\n` + getGamesMenu();
        } catch (error) {
            logger.error('[Joke Game] Error in startGame:', error);
            return `\r\nSorry, an error occurred getting the joke. Please try again later.\r\n` +
                   `\r\n` + getGamesMenu();
        }
    }
    
    processGameCommand(sessionKey, command, gameStates, getGamesMenu, setGamesMenuState) {
        try {
            if (!this.jokes || this.jokes.length === 0) {
                setGamesMenuState();
                return `\r\nJoke of the Day is currently unavailable (jokes file not found).\r\n` +
                       `\r\n` + getGamesMenu();
            }

            switch (command) {
                case 'another':
                case 'a': {
                    // Get a random joke
                    const randomIndex = Math.floor(Math.random() * this.jokes.length);
                    const randomJoke = this.jokes[randomIndex];
                    
                    return `\r\nRANDOM JOKE\r\n` +
                           `\r\n` +
                           `${randomJoke}\r\n` +
                           `\r\n` +
                           `Want another one? Type 'ANOTHER' or 'EXIT' to return to games menu.\r\n` +
                           `\r\n` +
                           `Enter command: `;
                }
                case 'exit':
                    setGamesMenuState(); // Reset menu state to games
                    return `\r\nThanks for enjoying some laughs!\r\n` +
                           `Come back tomorrow for a new joke of the day!\r\n` +
                           `\r\n` + getGamesMenu();
                    
                default:
                    return `Invalid command!\r\n` +
                           `Type 'ANOTHER' for a random joke, or 'EXIT' to return to games menu.\r\n` +
                           `\r\n` +
                           `Enter command: `;
            }
        } catch (error) {
            logger.error('[Joke Game] Error in processGameCommand:', error);
            setGamesMenuState();
            return `\r\nSorry, an error occurred. Returning to games menu.\r\n` +
                   `\r\n` + getGamesMenu();
        }
    }
}

module.exports = JokeGame;
