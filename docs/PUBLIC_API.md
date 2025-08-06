# Public API Documentation

A public REST API for accessing UK pub data without authentication. This API is s### 3. Find Pubs Near Location

```
GET /api/v1/pubs/near
```

Find pubs within a specified radius of a geographic location.

**Query Parameters:**

- `lat` (number, required): Latitude
- `lng` (number, required): Longitude
- `radius` (number): Search radius in kilometers (default: 5)
- `limit` (number): Maximum results (default: 20, max: 50)

**Example:**

````bash
curl "http://localhost:4000/api/v1/pubs/near?lat=51.5074&lng=-0.1278&radius=2"
```n application endpoints and designed for external consumption.

## Base URL

````

http://localhost:4000/api/v1

```

## Endpoints

### 1. Get All Pubs

```

GET /api/v1/pubs

````

Retrieve a paginated list of pubs with optional filtering.

**Query Parameters:**

- `city` (string): Filter by city name (partial match, case-insensitive)
- `tag` (string): Filter by tag (exact match)
- `name` (string): Filter by pub name (partial match, case-insensitive)
- `operator` (string): Filter by operator/brewery name (partial match, case-insensitive)
- `borough` (string): Filter by borough (partial match, case-insensitive)
- `postcode` (string): Filter by postcode (partial match, case-insensitive)
- `area` (string): Filter by area (partial match, case-insensitive)
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 50, max: 100)

**Example:**

```bash
curl "http://localhost:4000/api/v1/pubs?city=London&limit=10"
````

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "pub_id",
      "name": "The Red Lion",
      "city": "London",
      "address": "123 High Street",
      "postcode": "SW1A 1AA",
      "lat": 51.5074,
      "lng": -0.1278,
      "website": "https://example.com",
      "description": "A traditional London pub",
      "imageUrl": "https://example.com/image.jpg",
      "tags": ["traditional", "food"],
      "operator": "Greene King",
      "area": "Westminster",
      "phone": "+44 20 1234 5678",
      "borough": "Westminster",
      "openingHours": "Mon-Sun 12:00-23:00",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1250,
    "pages": 125,
    "hasNext": true,
    "hasPrev": false
  },
  "filters": {
    "city": "London",
    "tag": null,
    "name": null,
    "operator": null,
    "borough": null,
    "postcode": null,
    "area": null
  }
}
```

### 2. Get Single Pub

```
GET /api/v1/pubs/:id
```

Retrieve a specific pub by its ID.

**Example:**

```bash
curl "http://localhost:4000/api/v1/pubs/pub_12345"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "pub_12345",
    "name": "The Red Lion"
    // ... full pub data
  }
}
```

### 3. Find Pubs Near Location

```
GET /public/v1/pubs/near
```

Find pubs within a specified radius of a geographic location.

**Query Parameters:**

- `lat` (number, required): Latitude
- `lng` (number, required): Longitude
- `radius` (number): Search radius in kilometers (default: 5)
- `limit` (number): Maximum results (default: 20, max: 50)

**Example:**

```bash
curl "http://localhost:4000/public/v1/pubs/near?lat=51.5074&lng=-0.1278&radius=2"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "pub_123",
      "name": "The Red Lion",
      // ... pub data
      "distance": 0.45
    }
  ],
  "search": {
    "center": { "lat": 51.5074, "lng": -0.1278 },
    "radius": 2,
    "found": 15
  }
}
```

### 4. Get Statistics

```
GET /api/v1/stats
```

Get comprehensive database statistics including counts and top lists.

**Example:**

```bash
curl "http://localhost:4000/api/v1/stats"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "overview": {
      "totalPubs": 5000,
      "totalCities": 150,
      "totalOperators": 25,
      "totalBoroughs": 33,
      "totalTags": 50
    },
    "topCities": [
      { "name": "London", "count": 1200 },
      { "name": "Manchester", "count": 300 }
    ],
    "topOperators": [
      { "name": "Greene King", "count": 500 },
      { "name": "Wetherspoons", "count": 400 }
    ],
    "topBoroughs": [
      { "name": "Westminster", "count": 200 },
      { "name": "Camden", "count": 150 }
    ],
    "popularTags": [
      { "name": "food", "count": 800 },
      { "name": "traditional", "count": 600 }
    ]
  }
}
```

### 5. Get Filter Options

```
GET /api/v1/filters
```

Get all available filter values for use in dropdown menus or autocomplete.

**Example:**

```bash
curl "http://localhost:4000/api/v1/filters"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "cities": ["London", "Manchester", "Birmingham", ...],
    "operators": ["Greene King", "Wetherspoons", "Fuller's", ...],
    "boroughs": ["Westminster", "Camden", "Islington", ...],
    "areas": ["Central London", "North London", ...],
    "tags": ["food", "traditional", "gastropub", "live-music", ...]
  }
}
```

### 6. API Information

```
GET /api/v1/info
```

Get information about the API and available endpoints.

## Response Format

All responses follow a consistent format:

**Success Response:**

```json
{
  "success": true,
  "data": { ... },
  // additional metadata like pagination, filters, etc.
}
```

**Error Response:**

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message"
}
```

## HTTP Status Codes

- `200 OK`: Request successful
- `400 Bad Request`: Invalid request parameters
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

## Rate Limiting

Currently no rate limiting is applied, but this may change in the future. Please use the API responsibly.

## Examples

### Search for pubs in London with food

```bash
curl "http://localhost:4000/api/v1/pubs?city=London&tag=food"
```

### Find pubs near a specific location

```bash
curl "http://localhost:4000/api/v1/pubs/near?lat=51.5074&lng=-0.1278&radius=1"
```

### Get pubs by operator with pagination

```bash
curl "http://localhost:4000/api/v1/pubs?operator=Greene King&page=2&limit=25"
```

### Search by pub name

```bash
curl "http://localhost:4000/api/v1/pubs?name=Red Lion"
```

## Notes

- All text searches are case-insensitive
- Multiple filters can be combined
- Distance calculations use the haversine formula for accuracy
- Pagination starts at page 1
- Maximum of 100 items per page to prevent large responses

## Future Features

When API key authentication is implemented:

- Higher rate limits for authenticated users
- Additional endpoints for data modification
- Usage analytics and monitoring
- Premium features for paid tiers
