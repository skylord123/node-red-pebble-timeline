# node-red-pebble-timeline

Node-RED nodes for interacting with the Pebble Timeline API, allowing you to add, delete, and list timeline pins for Pebble smartwatches using the Rebble Timeline service.

This package provides nodes that make it easy to create and manage timeline pins for Pebble smartwatches through the Rebble Timeline API, which maintains Pebble functionality after the official Pebble service was discontinued.

![example.png](examples/example.png)

## Features

- **Add Timeline Pins**: Create pins with various layouts (generic, calendar, sports, weather)
- **Delete Timeline Pins**: Remove pins from the timeline
- **List Timeline Pins**: View pins that have been added to the timeline
- **Token-based Organization**: Pins are organized by timeline token, allowing you to manage pins for multiple apps
- **Automatic Cleanup**: Pins older than one month are automatically removed to prevent storage bloat
- **Comprehensive Configuration**: Full support for all pin properties and layouts

## Installation

Install from your Node-RED Manage Palette or run the following command in your Node-RED user directory:

```
npm install node-red-pebble-timeline
```

## Usage

### Configuration

1. Add a "Pebble Timeline Config" node to your flow
2. Configure the API URL (defaults to https://timeline-api.rebble.io)
3. Add your timeline token
   - You can obtain this by installing the [Generate Token](https://apps.rebble.io/en_US/application/5d9ac26dc393f54d6b5f5445?query=timeline%2520token&section=watchapps) app on your Pebble watch and following the instructions to generate a token
   - Another method is using the [Home Assistant WS](https://github.com/skylord123/pebble-home-assistant-ws) app. It will give you the timeline token in the config page on the mobile phone.

### Adding Pins

1. Add a "Add Timeline Pin" node to your flow
2. Configure the pin properties (ID, time, layout, etc.)
3. Connect it to a trigger node or other input
4. Deploy and run your flow

### Deleting Pins

1. Add a "Delete Timeline Pin" node to your flow
2. Configure the pin ID to delete
3. Connect it to a trigger node or other input
4. Deploy and run your flow

### Listing Pins

1. Add a "List Timeline Pins" node to your flow
2. Configure any filter options (start time, end time)
3. Connect it to a trigger node or other input
4. Deploy and run your flow

## Pin Storage

Pins are stored locally in the Node-RED user directory, organized by timeline token. Each token has its own separate list of pins, and pins older than one month are automatically cleaned up to prevent the storage file from growing too large.

## Example Flows

Check out the [examples](examples) directory for sample flows that demonstrate how to use these nodes.

## API Documentation

For detailed information about the Pebble Timeline API and pin structure, refer to:
- [Pebble Timeline Developer Guide](https://developer.pebble.com/guides/pebble-timeline/)
- [Pebble Timeline Pin Structure](https://developer.pebble.com/guides/pebble-timeline/pin-structure/)

## License

This project is licensed under the MIT License.
