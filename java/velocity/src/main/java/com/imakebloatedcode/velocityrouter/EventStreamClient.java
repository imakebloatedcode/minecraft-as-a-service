package com.imakebloatedcode.velocityrouter;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.net.UnknownHostException;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.fasterxml.jackson.databind.ObjectMapper;

import org.msgpack.jackson.dataformat.MessagePackFactory;

public class EventStreamClient {

    private final VelocityServerPlugin plugin;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ObjectMapper mapper = new ObjectMapper(new MessagePackFactory());

    private Socket socket;

    public EventStreamClient(VelocityServerPlugin plugin) throws UnknownHostException, IOException {
        this.plugin = plugin;
        this.socket = new Socket("runner", 61966);
    }

    public void start() {
        executor.submit(this::runLoop);
    }

    public void sendMessage(ApiSentTypes.BaseCommunication packet) throws IOException {
        OutputStream out = socket.getOutputStream();

        byte[] encoded = mapper.writeValueAsBytes(packet);
        out.write(unsignedIntToBytes(encoded.length));
        out.write(encoded);
    }

    private void runLoop() {
        try {
            InputStream in = socket.getInputStream();

            while (true) {
                int length = this.bytesToUnsignedInt(this.readBytes(in, 4));

                byte[] payload = this.readBytes(in, length);

                ApiReceiveTypes.BaseCommunication decoded = mapper.readValue(payload,
                        ApiReceiveTypes.BaseCommunication.class);

                if (decoded instanceof ApiReceiveTypes.Kick data) {
                    plugin.handleKick(UUID.fromString(data.userUuid), data.message);
                } else if (decoded instanceof ApiReceiveTypes.Switch data) {
                    plugin.handleSwitch(UUID.fromString(data.userUuid), data.ip, data.port, data.serverUuid);
                }
            }

        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private byte[] readBytes(InputStream in, int n) throws IOException {
        byte[] data = new byte[n];
        int offset = 0;

        while (offset < n) {
            int read = in.read(data, offset, n - offset);
            if (read == -1)
                return null;
            offset += read;
        }

        return data;
    }

    private int bytesToUnsignedInt(byte[] b) {
        int result = ((int) (b[0] & 0xFF) << 24) |
                ((int) (b[1] & 0xFF) << 16) |
                ((int) (b[2] & 0xFF) << 8) |
                ((int) (b[3] & 0xFF));
        if (result < 0) {
            throw new Error("While parsing uint: uint exceeded the 32 bit int limit");
        }
        return result;
    }

    private byte[] unsignedIntToBytes(int i) {
        if (i < 0) {
            throw new Error("Negative values are not allowed");
        }
        byte[] result = { (byte) (i >> 24), (byte) (i >> 16), (byte) (i >> 8), (byte) (i & 0xff) };
        return result;
    }
}