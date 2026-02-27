'use strict';

class BlackjackGame {
    constructor() {
        this.gameName = 'Blackjack';
        this.gameCommands = ['b', 'blackjack', 'blkjk'];
    }

    createDeck() {
        const suits = ['♠', '♥', '♦', '♣'];
        const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const deck = [];
        
        for (const suit of suits) {
            for (const rank of ranks) {
                deck.push({ suit, rank });
            }
        }
        
        // Shuffle the deck
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        
        return deck;
    }
    
    getCardValue(card) {
        if (card.rank === 'A') return 11; // Ace initially counts as 11
        if (['J', 'Q', 'K'].includes(card.rank)) return 10;
        return parseInt(card.rank);
    }
    
    calculateHandValue(hand) {
        let value = 0;
        let aces = 0;
        
        for (const card of hand) {
            if (card.rank === 'A') {
                aces++;
                value += 11;
            } else if (['J', 'Q', 'K'].includes(card.rank)) {
                value += 10;
            } else {
                value += parseInt(card.rank);
            }
        }
        
        // Adjust for aces if over 21
        while (value > 21 && aces > 0) {
            value -= 10; // Convert ace from 11 to 1
            aces--;
        }
        
        return value;
    }
    
    formatCard(card) {
        return `${card.rank}${card.suit}`;
    }
    
    formatHand(hand, hideFirst = false) {
        if (hideFirst && hand.length > 0) {
            const visibleCards = hand.slice(1).map(card => this.formatCard(card)).join(' ');
            return `[Hidden] ${visibleCards}`;
        }
        return hand.map(card => this.formatCard(card)).join(' ');
    }

    startGame(sessionKey, gameStates) {
        // Initialize game state
        const deck = this.createDeck();
        const playerHand = [deck.pop(), deck.pop()];
        const dealerHand = [deck.pop(), deck.pop()];
        
        const gameState = {
            deck: deck,
            playerHand: playerHand,
            dealerHand: dealerHand,
            gamePhase: 'playing', // 'playing', 'dealer_turn', 'finished'
            gameStartTime: new Date()
        };
        
        gameStates.set(sessionKey, gameState);
        
        const playerValue = this.calculateHandValue(playerHand);
        const dealerVisibleValue = this.getCardValue(dealerHand[1]);
        
        let gameDisplay = `\r\n🃏 === BLACKJACK === 🃏\r\n` +
                         `\r\n` +
                         `Welcome to the classic casino game!\r\n` +
                         `Get as close to 21 as possible without going over.\r\n` +
                         `Face cards = 10, Aces = 1 or 11\r\n` +
                         `\r\n` +
                         `🎴 DEALER'S HAND:\r\n` +
                         `${this.formatHand(dealerHand, true)} (Showing: ${dealerVisibleValue})\r\n` +
                         `\r\n` +
                         `🎯 YOUR HAND:\r\n` +
                         `${this.formatHand(playerHand)} (Total: ${playerValue})\r\n` +
                         `\r\n`;
        
        // Check for natural blackjack
        if (playerValue === 21) {
            const dealerValue = this.calculateHandValue(dealerHand);
            if (dealerValue === 21) {
                // Push (tie)
                gameStates.delete(sessionKey);
                gameDisplay += `🎊 NATURAL BLACKJACK! But dealer also has 21...\r\n` +
                              `🤝 IT'S A PUSH (TIE)!\r\n` +
                              `\r\nDealer had: ${this.formatHand(dealerHand)} (${dealerValue})\r\n`;
            } else {
                // Player wins with natural blackjack
                gameStates.delete(sessionKey);
                gameDisplay += `🎉 NATURAL BLACKJACK! YOU WIN! 🎉\r\n` +
                              `💰 That's a beautiful 21! 💰\r\n` +
                              `\r\nDealer had: ${this.formatHand(dealerHand)} (${dealerValue})\r\n`;
            }
        } else {
            gameDisplay += `📝 Commands:\r\n` +
                          `• HIT (H) - Take another card\r\n` +
                          `• STAND (S) - Keep your current hand\r\n` +
                          `• EXIT - Return to games menu\r\n` +
                          `• BYE - Disconnect\r\n` +
                          `\r\n` +
                          `🎲 What's your move? `;
        }
        
        return gameDisplay;
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
            return `\r\nThanks for playing Blackjack! 🎰\r\n` +
                   `Come back anytime for another hand!\r\n` +
                   `\r\n` + getGamesMenu();
        }
        
        if (gameState.gamePhase === 'playing') {
            return this.processPlayerTurn(sessionKey, command, gameState, gameStates, getGamesMenu, setGamesMenuState);
        } else if (gameState.gamePhase === 'dealer_turn') {
            return this.processDealerTurn(sessionKey, gameState, gameStates, getGamesMenu, setGamesMenuState);
        } else {
            // Game finished, should not happen
            return getGamesMenu();
        }
    }
    
    processPlayerTurn(sessionKey, command, gameState, gameStates, getGamesMenu, setGamesMenuState) {
        switch (command) {
            case 'h':
            case 'hit':
                // Player takes a card
                const newCard = gameState.deck.pop();
                gameState.playerHand.push(newCard);
                
                const playerValue = this.calculateHandValue(gameState.playerHand);
                
                let response = `\r\n🎴 You drew: ${this.formatCard(newCard)}\r\n` +
                              `🎯 YOUR HAND: ${this.formatHand(gameState.playerHand)} (Total: ${playerValue})\r\n`;
                
                if (playerValue > 21) {
                    // Player busts
                    gameStates.delete(sessionKey);
                    setGamesMenuState(); // Reset menu state to games
                    response += `\r\n💥 BUST! You went over 21! 💥\r\n` +
                               `😔 Better luck next time!\r\n` +
                               `\r\nDealer had: ${this.formatHand(gameState.dealerHand)} (${this.calculateHandValue(gameState.dealerHand)})\r\n` +
                               `\r\n` + getGamesMenu();
                } else if (playerValue === 21) {
                    // Player has 21, move to dealer turn
                    response += `\r\n🎯 Perfect 21! Now let's see what the dealer does...\r\n`;
                    gameState.gamePhase = 'dealer_turn';
                    response += this.processDealerTurn(sessionKey, gameState, gameStates, getGamesMenu, setGamesMenuState);
                } else {
                    // Continue playing
                    response += `\r\n🎲 Hit or Stand? `;
                }
                
                return response;
                
            case 's':
            case 'stand':
                // Player stands, dealer's turn
                gameState.gamePhase = 'dealer_turn';
                return `\r\n🛑 You stand with ${this.calculateHandValue(gameState.playerHand)}\r\n` +
                       `Now let's see what the dealer does...\r\n` +
                       this.processDealerTurn(sessionKey, gameState, gameStates, getGamesMenu, setGamesMenuState);
                
            default:
                return `🤔 Invalid command!\r\n` +
                       `Type 'HIT' (H) to take a card, 'STAND' (S) to keep your hand,\r\n` +
                       `or 'EXIT' to return to games menu.\r\n` +
                       `\r\n🎲 What's your move? `;
        }
    }
    
    processDealerTurn(sessionKey, gameState, gameStates, getGamesMenu, setGamesMenuState) {
        let response = `\r\n🎴 DEALER'S TURN:\r\n` +
                      `Dealer reveals: ${this.formatHand(gameState.dealerHand)} (${this.calculateHandValue(gameState.dealerHand)})\r\n`;
        
        // Dealer must hit on 16 and below, stand on 17 and above
        while (this.calculateHandValue(gameState.dealerHand) < 17) {
            const newCard = gameState.deck.pop();
            gameState.dealerHand.push(newCard);
            const dealerValue = this.calculateHandValue(gameState.dealerHand);
            response += `Dealer draws: ${this.formatCard(newCard)} - Total: ${dealerValue}\r\n`;
        }
        
        const playerValue = this.calculateHandValue(gameState.playerHand);
        const dealerValue = this.calculateHandValue(gameState.dealerHand);
        
        response += `\r\n🏁 FINAL RESULTS:\r\n` +
                   `🎯 Your hand: ${this.formatHand(gameState.playerHand)} (${playerValue})\r\n` +
                   `🎴 Dealer's hand: ${this.formatHand(gameState.dealerHand)} (${dealerValue})\r\n` +
                   `\r\n`;
        
        // Determine winner
        if (dealerValue > 21) {
            response += `🎉 DEALER BUSTS! YOU WIN! 🎉\r\n` +
                       `💰 The house went over 21! 💰\r\n`;
        } else if (playerValue > dealerValue) {
            response += `🎊 YOU WIN! 🎊\r\n` +
                       `🏆 Your ${playerValue} beats dealer's ${dealerValue}! 🏆\r\n`;
        } else if (dealerValue > playerValue) {
            response += `😔 Dealer wins with ${dealerValue}\r\n` +
                       `🎯 Your ${playerValue} wasn't quite enough.\r\n`;
        } else {
            response += `🤝 IT'S A PUSH (TIE)! 🤝\r\n` +
                       `🎯 Both hands equal ${playerValue}!\r\n`;
        }
        
        // Clean up game state and reset menu
        gameStates.delete(sessionKey);
        setGamesMenuState(); // Reset menu state to games
        
        response += `\r\n` + getGamesMenu();
        return response;
    }
}

module.exports = BlackjackGame;
