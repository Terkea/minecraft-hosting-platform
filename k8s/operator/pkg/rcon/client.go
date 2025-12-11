package rcon

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"time"
)

const (
	packetTypeCommand  = 2
	packetTypeAuth     = 3
	packetTypeResponse = 0
	packetTypeAuthResp = 2
)

type Client struct {
	conn      net.Conn
	requestID int32
}

// Connect establishes a connection to an RCON server
func Connect(address string, password string, timeout time.Duration) (*Client, error) {
	conn, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}

	client := &Client{
		conn:      conn,
		requestID: 1,
	}

	// Authenticate
	if err := client.authenticate(password); err != nil {
		conn.Close()
		return nil, fmt.Errorf("authentication failed: %w", err)
	}

	return client, nil
}

func (c *Client) authenticate(password string) error {
	if err := c.conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return fmt.Errorf("failed to set deadline: %w", err)
	}
	defer func() { _ = c.conn.SetDeadline(time.Time{}) }()

	// Send auth packet
	if err := c.sendPacket(packetTypeAuth, password); err != nil {
		return err
	}

	// Read response
	_, respType, _, err := c.readPacket()
	if err != nil {
		return err
	}

	if respType == -1 {
		return fmt.Errorf("authentication failed - wrong password")
	}

	return nil
}

// Execute sends a command and returns the response
func (c *Client) Execute(command string) (string, error) {
	if err := c.conn.SetDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return "", fmt.Errorf("failed to set deadline: %w", err)
	}
	defer func() { _ = c.conn.SetDeadline(time.Time{}) }()

	if err := c.sendPacket(packetTypeCommand, command); err != nil {
		return "", err
	}

	_, _, payload, err := c.readPacket()
	if err != nil {
		return "", err
	}

	return payload, nil
}

// Close closes the connection
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

func (c *Client) sendPacket(packetType int32, payload string) error {
	payloadBytes := []byte(payload)
	// Packet: length (4) + requestID (4) + type (4) + payload + null (2)
	length := int32(4 + 4 + len(payloadBytes) + 2)

	buf := new(bytes.Buffer)
	if err := binary.Write(buf, binary.LittleEndian, length); err != nil {
		return fmt.Errorf("failed to write length: %w", err)
	}
	if err := binary.Write(buf, binary.LittleEndian, c.requestID); err != nil {
		return fmt.Errorf("failed to write requestID: %w", err)
	}
	if err := binary.Write(buf, binary.LittleEndian, packetType); err != nil {
		return fmt.Errorf("failed to write packetType: %w", err)
	}
	if _, err := buf.Write(payloadBytes); err != nil {
		return fmt.Errorf("failed to write payload: %w", err)
	}
	if err := buf.WriteByte(0); err != nil {
		return fmt.Errorf("failed to write null byte: %w", err)
	}
	if err := buf.WriteByte(0); err != nil {
		return fmt.Errorf("failed to write null byte: %w", err)
	}

	c.requestID++

	_, err := c.conn.Write(buf.Bytes())
	return err
}

func (c *Client) readPacket() (int32, int32, string, error) {
	// Read length
	var length int32
	if err := binary.Read(c.conn, binary.LittleEndian, &length); err != nil {
		return 0, 0, "", err
	}

	// Read rest of packet
	data := make([]byte, length)
	if _, err := c.conn.Read(data); err != nil {
		return 0, 0, "", err
	}

	buf := bytes.NewReader(data)

	var requestID, packetType int32
	if err := binary.Read(buf, binary.LittleEndian, &requestID); err != nil {
		return 0, 0, "", fmt.Errorf("failed to read requestID: %w", err)
	}
	if err := binary.Read(buf, binary.LittleEndian, &packetType); err != nil {
		return 0, 0, "", fmt.Errorf("failed to read packetType: %w", err)
	}

	// Payload is rest minus 2 null bytes
	payloadLen := length - 4 - 4 - 2
	if payloadLen < 0 {
		payloadLen = 0
	}
	payload := make([]byte, payloadLen)
	if _, err := buf.Read(payload); err != nil {
		return 0, 0, "", fmt.Errorf("failed to read payload: %w", err)
	}

	return requestID, packetType, string(payload), nil
}

// PlayerInfo contains player count information
type PlayerInfo struct {
	Online    int
	Max       int
	Players   []string
}

// GetPlayerInfo queries the server and parses player count
// Response format: "There are X of a max of Y players online: player1, player2"
func GetPlayerInfo(address string, password string) (*PlayerInfo, error) {
	client, err := Connect(address, password, 5*time.Second)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	response, err := client.Execute("list")
	if err != nil {
		return nil, err
	}

	return ParsePlayerList(response)
}

// ParsePlayerList parses the "list" command response
func ParsePlayerList(response string) (*PlayerInfo, error) {
	// Match "There are X of a max of Y players online"
	re := regexp.MustCompile(`There are (\d+) of a max of (\d+) players online`)
	matches := re.FindStringSubmatch(response)

	if len(matches) < 3 {
		return nil, fmt.Errorf("could not parse player list: %s", response)
	}

	online, _ := strconv.Atoi(matches[1])
	max, _ := strconv.Atoi(matches[2])

	info := &PlayerInfo{
		Online:  online,
		Max:     max,
		Players: []string{},
	}

	// Parse player names if present (after colon)
	colonIdx := bytes.IndexByte([]byte(response), ':')
	if colonIdx > 0 && colonIdx < len(response)-1 {
		playerStr := response[colonIdx+1:]
		if len(playerStr) > 0 {
			// Split by comma and trim
			for _, name := range bytes.Split([]byte(playerStr), []byte(",")) {
				trimmed := bytes.TrimSpace(name)
				if len(trimmed) > 0 {
					info.Players = append(info.Players, string(trimmed))
				}
			}
		}
	}

	return info, nil
}
