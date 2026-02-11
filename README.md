# Who Is My Friend

Hidden identity setup for social deduction games. Create a room, pick a game,
and let everyone privately enter their role. The app reveals only the
information each role should know.

## Features

- Real-time rooms with Socket.IO
- Host controls for game selection and reveal timing
- Role visibility rules driven by JSON files
- Session restore on refresh

## How to Play

1. Host creates a room and gets a 4-digit code.
2. Players join using the code and their name.
3. Host selects a game and starts setup.
4. Each player enters the role they drew in real life.
5. When everyone confirms, the host reveals who each role should know.

## Available Games

- Secret Hitler
- The Resistance: Avalon

## Development

Install dependencies and run the dev server:

```
npm install
npm run dev
```

The app runs on http://localhost:3000.

## Production

Build and run locally:

```
npm run build
npm run start
```

## Docker

Build and run the container:

```
docker build -t who-is-my-friend .
docker run -p 8080:80 who-is-my-friend
```

Then open http://localhost:8080.

## Deployment Notes (Azure Container Apps)

Socket.IO uses sessions. If you scale beyond one replica, enable sticky
sessions or add a shared adapter (like Redis) to avoid `Session ID unknown`
errors during long-polling. You can also force WebSocket-only transport.

## Game Data Format

Games live in [data/games](data/games). Each file defines roles and visibility
rules using per-role visibility entries. Example:

```
{
	"id": "avalon",
	"name": "The Resistance: Avalon",
	"parties": [{ "id": "good", "name": "Loyal Servants of Arthur" }],
	"roles": [
		{
			"id": "merlin",
			"name": "Merlin",
			"partyId": "good",
			"visibility": [
				{ "roleId": "assassin", "scope": "party" }
			]
		}
	]
}
```

Supported visibility fields (per role):

- `roleId`: role to reveal.
- `scope`:
	- `party`: reveal the target role's party name.
	- `mask`: reveal a masked label.
	- `role`: reveal the target role's name.
- `mask`: label to show when `scope` is `mask`.

## Scripts

- `npm run dev` - run the Socket.IO dev server
- `npm run build` - build the Next.js app
- `npm run start` - run the production server
