'use strict';

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
        try {
            const jokesPath = path.join(__dirname, '..', 'jokes.txt');
            const jokesData = fs.readFileSync(jokesPath, 'utf8');
            this.jokes = jokesData.split('\n')
                .map(joke => joke.trim())
                .filter(joke => joke.length > 0);
            console.log(`[Joke Game] Loaded ${this.jokes.length} jokes`);
        } catch (error) {
            console.error('[Joke Game] Failed to load jokes:', error);
            this.jokes = ['Why did the computer go to the doctor? It had a virus!'];
        }
    }

    startGame(sessionKey, gameStates, getGamesMenu, setGamesMenuState) {
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

        // Reset menu state back to games immediately
        setGamesMenuState();

        return `\r\n😂 === JOKE OF THE DAY === 😂\r\n` +
               `\r\n` +
               `${dateStr}\r\n` +
               `\r\n` +
               `🎭 ${todaysJoke}\r\n` +
               `\r\n` +
               `Hope that brought a smile to your face! 😊\r\n` +
               `\r\n` + getGamesMenu();
    }
    
    processGameCommand(sessionKey, command, gameStates, getGamesMenu, setGamesMenuState) {
        switch (command) {
            case 'another':
            case 'a':
                // Get a random joke
                const randomIndex = Math.floor(Math.random() * this.jokes.length);
                const randomJoke = this.jokes[randomIndex];
                
                return `\r\n🎲 RANDOM JOKE 🎲\r\n` +
                       `\r\n` +
                       `🎭 ${randomJoke}\r\n` +
                       `\r\n` +
                       `😄 Want another one? Type 'ANOTHER' or 'EXIT' to return to games menu.\r\n` +
                       `\r\n` +
                       `Enter command: `;
                
            case 'exit':
                setGamesMenuState(); // Reset menu state to games
                return `\r\nThanks for enjoying some laughs! 😂\r\n` +
                       `Come back tomorrow for a new joke of the day!\r\n` +
                       `\r\n` + getGamesMenu();
                
            default:
                return `🤔 Invalid command!\r\n` +
                       `Type 'ANOTHER' for a random joke, or 'EXIT' to return to games menu.\r\n` +
                       `\r\n` +
                       `Enter command: `;
        }
    }
}

module.exports = JokeGame;
