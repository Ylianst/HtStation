'use strict';

class GuessTheNumberGame {
    constructor() {
        this.gameName = 'Guess the Number';
        this.gameCommands = ['g', 'guess', 'guessthenumber'];
    }

    startGame(sessionKey, gameStates) {
        // Generate random number between 0 and 1000
        const targetNumber = Math.floor(Math.random() * 1001);
        
        // Initialize game state
        const gameState = {
            targetNumber: targetNumber,
            attempts: 0,
            gameStartTime: new Date()
        };
        
        gameStates.set(sessionKey, gameState);
        
        return `\r\n🎲 === GUESS THE NUMBER === 🎲\r\n` +
               `\r\n` +
               `Welcome to the ultimate number guessing challenge!\r\n` +
               `I've picked a secret number between 0 and 1000.\r\n` +
               `Can you figure out what it is?\r\n` +
               `\r\n` +
               `📝 Instructions:\r\n` +
               `• Type any number to make your guess\r\n` +
               `• I'll tell you if you're too HIGH or too LOW\r\n` +
               `• Type 'EXIT' to return to games menu\r\n` +
               `• Type 'BYE' to disconnect\r\n` +
               `\r\n` +
               `🎯 Ready? Make your first guess! `;
    }
    
    processGameCommand(sessionKey, command, gameStates, getGamesMenu, setGamesMenuState) {
        const gameState = gameStates.get(sessionKey);
        
        if (!gameState) {
            // Game state lost, restart
            return `Game state lost! Returning to games menu.\r\n` + getGamesMenu();
        }
        
        // Handle exit command
        if (command === 'exit') {
            gameStates.delete(sessionKey);
            setGamesMenuState(); // Reset menu state to games
            return `\r\nThanks for playing! 🎮\r\n` +
                   `You made ${gameState.attempts} attempt${gameState.attempts !== 1 ? 's' : ''}.\r\n` +
                   `The secret number was ${gameState.targetNumber}.\r\n` +
                   `\r\n` + getGamesMenu();
        }
        
        // Parse the guess
        const guess = parseInt(command);
        
        if (isNaN(guess)) {
            return `🤔 That doesn't look like a number!\r\n` +
                   `Please enter a number between 0 and 1000, or 'EXIT' to quit.\r\n` +
                   `\r\nTry again: `;
        }
        
        if (guess < 0 || guess > 1000) {
            return `📏 Your guess must be between 0 and 1000!\r\n` +
                   `You guessed ${guess}, but I need something in the range.\r\n` +
                   `\r\nTry again: `;
        }
        
        gameState.attempts++;
        
        if (guess === gameState.targetNumber) {
            // Winner!
            const gameTime = new Date() - gameState.gameStartTime;
            const seconds = Math.floor(gameTime / 1000);
            
            gameStates.delete(sessionKey);
            setGamesMenuState(); // Reset menu state to games
            
            let celebration = `\r\n🎉 CONGRATULATIONS! YOU WON! 🎉\r\n` +
                            `\r\n` +
                            `🎯 You guessed it! The number was ${gameState.targetNumber}!\r\n` +
                            `📊 Total attempts: ${gameState.attempts}\r\n` +
                            `⏱️  Time taken: ${seconds} second${seconds !== 1 ? 's' : ''}\r\n`;
            
            // Add performance rating
            if (gameState.attempts <= 3) {
                celebration += `🏆 AMAZING! You're a number-guessing wizard! ✨\r\n`;
            } else if (gameState.attempts <= 7) {
                celebration += `🌟 EXCELLENT! That was some great guessing! 👍\r\n`;
            } else if (gameState.attempts <= 12) {
                celebration += `👏 GOOD JOB! Nice work figuring it out! 😊\r\n`;
            } else {
                celebration += `🎈 You did it! Persistence pays off! 💪\r\n`;
            }
            
            celebration += `\r\n` + getGamesMenu();
            return celebration;
            
        } else if (guess < gameState.targetNumber) {
            // Too low
            const diff = gameState.targetNumber - guess;
            let hint = '';
            
            if (diff > 500) {
                hint = '🚀 WAY too low! Think much bigger!';
            } else if (diff > 100) {
                hint = '📈 Too low! Go higher!';
            } else if (diff > 25) {
                hint = '⬆️  Getting closer, but still too low!';
            } else if (diff > 5) {
                hint = '🔥 You\'re getting warm! A bit higher!';
            } else {
                hint = '🌡️  SO CLOSE! Just a tiny bit higher!';
            }
            
            return `\r\n${hint}\r\n` +
                   `📊 Attempt ${gameState.attempts}: ${guess} is too LOW\r\n` +
                   `🎯 Keep trying! What's your next guess? `;
            
        } else {
            // Too high
            const diff = guess - gameState.targetNumber;
            let hint = '';
            
            if (diff > 500) {
                hint = '🛬 WAY too high! Think much smaller!';
            } else if (diff > 100) {
                hint = '📉 Too high! Go lower!';
            } else if (diff > 25) {
                hint = '⬇️  Getting closer, but still too high!';
            } else if (diff > 5) {
                hint = '🔥 You\'re getting warm! A bit lower!';
            } else {
                hint = '🌡️  SO CLOSE! Just a tiny bit lower!';
            }
            
            return `\r\n${hint}\r\n` +
                   `📊 Attempt ${gameState.attempts}: ${guess} is too HIGH\r\n` +
                   `🎯 Keep trying! What's your next guess? `;
        }
    }
}

module.exports = GuessTheNumberGame;
