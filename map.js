import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

mapboxgl.accessToken = 'pk.eyJ1IjoiZGthbm9kaWEiLCJhIjoiY21hcWdtZDRpMDliajJscHVoZGpmcjRzaSJ9.Dp2JksE8ikE0BNaYfWNqNQ';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips // If no filter is applied (-1), return all trips
    : trips.filter((trip) => {
        // Convert trip start and end times to minutes since midnight
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        // Include trips that started or ended within 60 minutes of the selected time
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function computeStationTraffic(stations, trips) {
  // Compute departures
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  // Update each station
  return stations.map((station) => {
    let id = station.short_name; // Note: short_name is used as station ID in traffic data
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

map.on('load', async () => {
  try {
    let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

    // Add bike lanes layer
    map.addSource('boston_route', {
      type: 'geojson',
      data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });

    map.addSource('Cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
      });

    map.addLayer({
      id: 'bike-lanes',
      type: 'line',
      source: 'boston_route',
      paint: {
        'line-color': '#32D400',  // A bright green using hex code
        'line-width': 5,          // Thicker lines
        'line-opacity': 0.6       // Slightly less transparent
      }
    });

  
      map.addLayer({
        id: 'cambridge',
        type: 'line',
        source: 'Cambridge_route',
        paint: {
          'line-color': '#32D400',  // A bright green using hex code
          'line-width': 5,          // Thicker lines
          'line-opacity': 0.6       // Slightly less transparent
        }
      });

    // Fetch the station data
    const jsonUrl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
    const stationData = await d3.json(jsonUrl);
    const stations = stationData.data.stations;

    // Fetch the trip data
    const trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      }
    );

    // Get references to the DOM elements (corrected selectors)
    const timeSlider = document.getElementById('time-slider'); // Removed # from ID
    const selectedTime = document.getElementById('selected-time'); // Removed # from ID
    const anyTimeLabel = document.getElementById('any-time'); // Removed # from ID

    // Compute initial station traffic
    const stationsWithTraffic = computeStationTraffic(stations, trips);
    
    // Create scale for circle radius
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stationsWithTraffic, (d) => d.totalTraffic)])
      .range([0, 25]);
    
    // Create SVG overlay for D3 if it doesn't exist yet
    let svg = d3.select('#map').select('svg');
    if (svg.empty()) {
      svg = d3.select('#map')
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .style('position', 'absolute')
        .style('pointer-events', 'none')
        .style('z-index', 10);
    }

    // Create circles for each station
    const circles = svg
      .selectAll('circle')
      .data(stationsWithTraffic, (d) => d.short_name) // Use station short_name as the key
      .join('circle') // Using join instead of enter to handle updates
      .attr('r', d => radiusScale(d.totalTraffic)) // Radius of the circle
      .attr('fill', 'steelblue') // Circle fill color
      .attr('stroke', 'white') // Circle border color
      .attr('stroke-width', 1) // Circle border thickness
      .attr('opacity', 0.8)
      .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic),
    );; // Circle opacity
    
    // Add tooltips to circles
    const tooltip = d3.select('body')
    .append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0);
  
  // Attach events to each circle
  circles.on('mouseover', function (event, d) {
      tooltip.transition()
        .duration(200)
        .style('opacity', 1);
      tooltip.html(`${d.totalTraffic} trips<br>(${d.departures} departures, ${d.arrivals} arrivals)`);
    })
    .on('mousemove', function (event) {
      tooltip
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY - 28) + 'px');
    })
    .on('mouseout', function () {
      tooltip.transition()
        .duration(300)
        .style('opacity', 0);
    });

    // Function to update circle positions when map moves
    function updatePositions() {
      circles
        .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
        .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
    }

    // Apply initial positions
    updatePositions();
    
    // Function to update visualization based on time filter
    function updateScatterPlot(timeFilter) {
      // Get only the trips that match the selected time filter
      const filteredTrips = filterTripsbyTime(trips, timeFilter);
      
      // Recompute station traffic based on the filtered trips
      const filteredStations = computeStationTraffic(stations, filteredTrips);
      
      // Adjust the radius scale range based on time filter
      if (timeFilter === -1) {
        radiusScale.range([0, 25]);
      } else {
        radiusScale.range([3, 50]);
      }
      
      // Update the scatterplot by adjusting the radius of circles
      svg.selectAll('circle')
        .data(filteredStations, (d) => d.short_name) // Ensure D3 tracks elements correctly
        .join('circle') // Properly handle enter/update/exit
        .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
        .attr('cx', (d) => getCoords(d).cx) // Update positions
        .attr('cy', (d) => getCoords(d).cy)
        .attr('fill', 'steelblue')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8)
        .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
      );
    }

    // Function to update time display
    function updateTimeDisplay() {
      const timeFilter = Number(timeSlider.value); // Get slider value
      
      if (timeFilter === -1) {
        selectedTime.textContent = ''; // Clear time display
        anyTimeLabel.style.display = 'block'; // Show "(any time)"
      } else {
        selectedTime.textContent = formatTime(timeFilter); // Display formatted time
        anyTimeLabel.style.display = 'none'; // Hide "(any time)"
      }
      
      // Update visualization based on time filter
      updateScatterPlot(timeFilter);
    }
    
    // Add event listeners
    if (timeSlider) {
      timeSlider.addEventListener('input', updateTimeDisplay);
      // Initialize the display
      updateTimeDisplay();
    } else {
      console.error("Time slider element not found");
    }

    // Update circle positions when map changes
    map.on('move', updatePositions); // Update during map movement
    map.on('zoom', updatePositions); // Update during zooming
    map.on('resize', updatePositions); // Update on window resize
    map.on('moveend', updatePositions); // Final adjustment after movement ends
  
  } catch (error) {
    console.error('Error loading data:', error); // Handle errors
  }
});